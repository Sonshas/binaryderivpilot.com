import { LIVE_MARKET_UNAVAILABLE } from '@/domain/account'
import {
  extractLastDigit,
  mapDerivCandle,
  mapDerivOhlc,
  timeframeToDerivGranularity,
} from '@/providers/market-data/deriv-digits'
import {
  getSharedDerivFeed,
  type DerivConnectionStatus,
  type DerivFeed,
  type DerivOhlcPayload,
  type DerivTickPayload,
} from '@/providers/market-data/deriv-feed'
import {
  REAL_FEED_LABEL_DERIV,
  REAL_MARKET_UNAVAILABLE,
  getMarketDataProviderId,
  isMarketDataProviderConfigured,
} from '@/providers/market-data/env'
import { reportBackendIssue } from '@/services/system-issues'
import {
  DERIV_REAL_TIMEFRAMES,
  buildDerivMarketCatalog,
  defaultRealDerivSymbol,
  getFallbackDerivCatalog,
  isDerivSymbol,
  mergeActiveSymbols,
  type DerivCatalogEntry,
} from '@/providers/market-data/deriv-symbols'
import type { MarketDataProvider, LiveCandleUpdate } from '@/providers/market-data/providers'
import { recordTick, recordTicks, registerLiveTickSource } from '@/providers/market-data/tick-buffer'
import type { Candle, ConnectionStatus, Market, MarketSnapshot, Tick, Timeframe } from '@/types'

export const STALE_MS = 10_000
const CANDLE_HISTORY_COUNT = 500
const SEAM_BACKFILL_DELAY_MS = 4_000
const CATALOG_TTL_MS = 5 * 60_000
const QUOTE_REFRESH_GAP_MS = 120

function isDerivRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /rate limit/i.test(message)
}

function mapStatus(status: DerivConnectionStatus): ConnectionStatus {
  switch (status) {
    case 'CONNECTED':
      return 'live'
    case 'CONNECTING':
      return 'connecting'
    case 'RECONNECTING':
      return 'reconnecting'
    case 'ERROR':
      return 'error'
    default:
      return 'disconnected'
  }
}

function disconnectedSnapshot(note: string): MarketSnapshot {
  return {
    status: 'disconnected',
    candles: [],
    lastTick: null,
    note,
    isSimulated: false,
    feedLabel: note,
    bid: null,
    ask: null,
    lastUpdateAt: null,
  }
}

function tickFromPayload(payload: DerivTickPayload): Tick {
  const lastDigit = extractLastDigit(payload.quote, payload.pipSize)
  return {
    symbol: payload.symbol,
    price: payload.quote,
    timestamp: payload.epoch * (payload.epoch < 1e12 ? 1000 : 1),
    epoch: payload.epoch,
    pipSize: payload.pipSize,
    lastDigit,
    isSimulated: false,
    feedLabel: REAL_FEED_LABEL_DERIV,
    bid: null,
    ask: null,
  }
}

function tickFromOhlc(ohlc: DerivOhlcPayload): Tick {
  return tickFromPayload({ symbol: ohlc.symbol, quote: ohlc.close, epoch: ohlc.epoch, pipSize: ohlc.pipSize })
}

function ticksFromHistory(
  symbol: string,
  hist: { prices: number[]; times: number[]; pipSize: number },
): Tick[] {
  const n = Math.min(hist.prices.length, hist.times.length)
  const ticks: Tick[] = []
  for (let i = 0; i < n; i += 1) {
    const quote = Number(hist.prices[i])
    const epoch = Number(hist.times[i])
    if (!Number.isFinite(quote) || !Number.isFinite(epoch)) continue
    ticks.push(tickFromPayload({ symbol, quote, epoch, pipSize: hist.pipSize }))
  }
  return ticks
}

class DerivRealMarketDataProvider implements MarketDataProvider {
  readonly id = 'real-deriv'
  readonly isSimulated = false

  private catalog: DerivCatalogEntry[] = getFallbackDerivCatalog()
  private catalogLoadedAt = 0
  private lastPrices = new Map<string, number>()
  private quoteEpochs = new Map<string, number>()
  private lastQuotes = new Map<string, Tick>()
  private lastMessageAt = 0
  private pipSizes = new Map<string, number>()
  private statusHandlers = new Set<(status: ConnectionStatus, detail?: string) => void>()
  private feedUnsub: (() => void) | null = null

  private feed(): DerivFeed {
    return getSharedDerivFeed()
  }

  private ensureListeners(): void {
    if (this.feedUnsub) return
    this.feedUnsub = this.feed().onTick((payload) => this.handleTick(payload))
    let wasConnected = false
    this.feed().onStatus((status) => {
      const mapped = mapStatus(status)
      for (const handler of this.statusHandlers) handler(mapped)
      if (status === 'CONNECTED') {
        if (wasConnected) for (const symbol of this.symbolRefs.keys()) this.scheduleSeamBackfill(symbol, 1000)
        wasConnected = true
      }
    })
  }

  private scheduleSeamBackfill(symbol: string, count = 60): void {
    setTimeout(() => {
      if (!this.symbolRefs.has(symbol)) return
      void this.getTickHistory(symbol, count).catch(() => undefined)
    }, SEAM_BACKFILL_DELAY_MS)
  }

  private handleTick(payload: DerivTickPayload): void {
    this.lastMessageAt = Date.now()
    this.setListQuote(payload.symbol, payload.quote, payload.epoch)
    this.pipSizes.set(payload.symbol, payload.pipSize)
    const tick = tickFromPayload(payload)
    this.lastQuotes.set(payload.symbol, tick)
    recordTick(tick)
  }

  getStatus(): ConnectionStatus {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') {
      return 'disconnected'
    }
    const status = mapStatus(this.feed().getConnectionStatus())
    if (status === 'live' && this.lastMessageAt > 0 && Date.now() - this.lastMessageAt > STALE_MS) {
      return 'error'
    }
    return status
  }

  getLatestQuote(symbol: string): Tick | null {
    return this.lastQuotes.get(symbol) ?? null
  }

  async getTickHistory(symbol: string, count = 1000): Promise<Tick[]> {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') return []
    this.ensureListeners()
    await this.feed().connect()
    const hist = await this.feed().getTicksHistory(symbol, count)
    const ticks = ticksFromHistory(symbol, hist)
    recordTicks(symbol, ticks)
    const last = ticks[ticks.length - 1]
    if (last?.epoch != null) this.setListQuote(symbol, last.price, last.epoch)
    return ticks
  }

  private setListQuote(symbol: string, price: number, epoch: number): void {
    if ((this.quoteEpochs.get(symbol) ?? 0) > epoch) return
    this.lastPrices.set(symbol, price)
    this.quoteEpochs.set(symbol, epoch)
  }

  async refreshQuotes(symbols: string[]): Promise<void> {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') return
    await this.feed().connect()
    // Serialize history pulls — parallel ticks_history for the full catalog trips Deriv rate limits.
    for (const symbol of symbols) {
      try {
        const hist = await this.feed().getTicksHistory(symbol, 1)
        const n = Math.min(hist.prices.length, hist.times.length)
        if (n === 0) continue
        this.setListQuote(symbol, Number(hist.prices[n - 1]), Number(hist.times[n - 1]))
      } catch (err) {
        if (isDerivRateLimit(err)) break
      }
      if (QUOTE_REFRESH_GAP_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, QUOTE_REFRESH_GAP_MS))
      }
    }
  }

  async backfillRange(symbol: string, fromMs: number, toMs: number): Promise<void> {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') return
    await this.feed().connect()
    const hist = await this.feed().getTicksRange(
      symbol,
      Math.floor(fromMs / 1000),
      Math.ceil(toMs / 1000),
      50,
    )
    recordTicks(symbol, ticksFromHistory(symbol, hist))
  }

  async listMarkets(): Promise<Market[]> {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') {
      return []
    }
    this.ensureListeners()
    if (Date.now() - this.catalogLoadedAt > CATALOG_TTL_MS) {
      try {
        await this.feed().connect()
        const active = await this.feed().getActiveSymbols()
        this.catalog = mergeActiveSymbols(active)
        this.catalogLoadedAt = Date.now()
        for (const entry of this.catalog) {
          this.pipSizes.set(entry.symbol, entry.pipSize)
        }
      } catch {
        this.catalog = getFallbackDerivCatalog()
      }
    }
    return buildDerivMarketCatalog(this.catalog, this.lastPrices, this.getStatus(), this.quoteEpochs)
  }

  async getMarket(symbol: string): Promise<Market | null> {
    const markets = await this.listMarkets()
    return markets.find((m) => m.symbol === symbol) ?? null
  }

  async getSnapshot(symbol: string, timeframe: Timeframe): Promise<MarketSnapshot> {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') {
      return disconnectedSnapshot(LIVE_MARKET_UNAVAILABLE)
    }
    if (!isDerivSymbol(symbol, this.catalog.length ? this.catalog : getFallbackDerivCatalog())) {
      if (!/^[A-Z0-9_]+$/i.test(symbol)) {
        return disconnectedSnapshot(
          REAL_MARKET_UNAVAILABLE,
        )
      }
    }
    if (!(DERIV_REAL_TIMEFRAMES as readonly string[]).includes(timeframe)) {
      return disconnectedSnapshot(
        REAL_MARKET_UNAVAILABLE,
      )
    }

    this.ensureListeners()
    try {
      await this.feed().connect()
      const granularity = timeframeToDerivGranularity(timeframe)
      let candles: Candle[] = []
      if (granularity != null) {
        const hist = await this.feed().getCandlesHistory(symbol, granularity, CANDLE_HISTORY_COUNT)
        candles = hist.candles
          .map((c) => mapDerivCandle(c))
          .filter((c): c is Candle => c != null)
      }

      const lastTick: Tick | null = this.lastQuotes.get(symbol) ?? null

      const liveStatus = this.getStatus()
      const status: ConnectionStatus =
        liveStatus === 'live' || liveStatus === 'connecting' || liveStatus === 'reconnecting'
          ? liveStatus === 'live' && this.lastQuotes.has(symbol)
            ? 'live'
            : liveStatus === 'live'
              ? 'connecting'
              : liveStatus
          : liveStatus === 'error'
            ? 'error'
            : candles.length > 0
              ? 'connecting'
              : 'disconnected'

      return {
        status,
        candles,
        lastTick,
        note: REAL_FEED_LABEL_DERIV,
        isSimulated: false,
        feedLabel: REAL_FEED_LABEL_DERIV,
        bid: null,
        ask: null,
        lastUpdateAt: lastTick?.timestamp ?? null,
      }
    } catch (err) {
      reportBackendIssue('market_data', 'deriv.snapshot', err)
      return {
        status: 'error',
        candles: [],
        lastTick: null,
        note: REAL_MARKET_UNAVAILABLE,
        isSimulated: false,
        feedLabel: REAL_MARKET_UNAVAILABLE,
        bid: null,
        ask: null,
        lastUpdateAt: null,
      }
    }
  }

  subscribeTicks(symbol: string, onTick: (tick: Tick) => void): () => void {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') {
      return () => undefined
    }
    this.ensureListeners()
    let active = true
    const unsubFeed = this.feed().onTick((payload) => {
      if (!active || payload.symbol !== symbol) return
      onTick(tickFromPayload(payload))
    })
    const release = this.retainSymbol(symbol)

    return () => {
      active = false
      unsubFeed()
      release()
    }
  }

  private symbolRefs = new Map<string, number>()

  private retainSymbol(symbol: string): () => void {
    const count = this.symbolRefs.get(symbol) ?? 0
    this.symbolRefs.set(symbol, count + 1)
    if (count === 0) {
      void this.feed()
        .connect()
        .then(() => this.feed().subscribeTicks(symbol))
        .then(() => this.scheduleSeamBackfill(symbol))
        .catch(() => undefined)
    }
    let released = false
    return () => {
      if (released) return
      released = true
      const next = (this.symbolRefs.get(symbol) ?? 1) - 1
      if (next <= 0) {
        this.symbolRefs.delete(symbol)
        void this.feed().unsubscribeTicks(symbol)
      } else {
        this.symbolRefs.set(symbol, next)
      }
    }
  }

  subscribeLive(
    symbol: string,
    timeframe: Timeframe,
    onUpdate: (update: LiveCandleUpdate) => void,
  ): () => void {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') {
      return () => undefined
    }
    const granularity = timeframeToDerivGranularity(timeframe)
    if (!(DERIV_REAL_TIMEFRAMES as readonly string[]).includes(timeframe) || granularity == null) {
      return () => undefined
    }
    this.ensureListeners()
    return this.feed().subscribeCandles(symbol, granularity, (ohlc) => {
      const candle = mapDerivOhlc({
        open_time: ohlc.openTime,
        open: ohlc.open,
        high: ohlc.high,
        low: ohlc.low,
        close: ohlc.close,
      })
      if (!candle) return
      onUpdate({ candle, isFinal: false, tick: tickFromOhlc(ohlc), bid: null, ask: null })
    })
  }

  onConnectionStatus(handler: (status: ConnectionStatus, detail?: string) => void): () => void {
    if (!isMarketDataProviderConfigured() || getMarketDataProviderId() !== 'deriv') {
      handler('disconnected', 'Market data provider not configured')
      return () => undefined
    }
    this.ensureListeners()
    this.statusHandlers.add(handler)
    handler(this.getStatus())
    return () => this.statusHandlers.delete(handler)
  }
}

const derivProviderInstance = new DerivRealMarketDataProvider()

export const derivRealMarketDataProvider: MarketDataProvider = derivProviderInstance

if (isMarketDataProviderConfigured() && getMarketDataProviderId() === 'deriv') {
  const settlementSubscriptions = new Set<string>()
  registerLiveTickSource({
    ensureSubscribed(symbol) {
      if (settlementSubscriptions.has(symbol)) return
      settlementSubscriptions.add(symbol)
      derivProviderInstance.subscribeTicks(symbol, () => undefined)
    },
    backfill(symbol, fromMs, toMs) {
      return derivProviderInstance.backfillRange(symbol, fromMs, toMs)
    },
    async loadRecent(symbol, count) {
      await derivProviderInstance.getTickHistory(symbol, count)
    },
  })
}

export { defaultRealDerivSymbol }
