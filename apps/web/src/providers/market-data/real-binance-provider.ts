import { LIVE_MARKET_UNAVAILABLE } from '@/domain/account'
import {
  getBinanceMarketFeed,
  type LiveCandleHandler,
} from '@/providers/market-data/binance-feed'
import {
  REAL_FEED_LABEL,
  REAL_MARKET_UNAVAILABLE,
  isMarketDataProviderConfigured,
} from '@/providers/market-data/env'
import { reportBackendIssue } from '@/services/system-issues'
import {
  BINANCE_TIMEFRAMES,
  buildBinanceMarketCatalog,
  isBinanceSymbol,
  toBinanceInterval,
} from '@/providers/market-data/binance-symbols'
import type {
  ConnectionStatus,
  Market,
  MarketSnapshot,
  Tick,
} from '@/types'
import type { MarketDataProvider } from '@/providers/market-data/providers'

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

export const binanceRealMarketDataProvider: MarketDataProvider = {
  id: 'real-binance',
  isSimulated: false,

  getStatus() {
    if (!isMarketDataProviderConfigured()) return 'disconnected'
    return getBinanceMarketFeed().getStatus()
  },

  async listMarkets() {
    if (!isMarketDataProviderConfigured()) {
      return []
    }
    const feed = getBinanceMarketFeed()
    const status = feed.getStatus()
    const priceStatus: ConnectionStatus =
      status === 'live' ? 'live' : status === 'connecting' || status === 'reconnecting' ? status : 'disconnected'
    return buildBinanceMarketCatalog(feed.getLastPrices(), priceStatus)
  },

  async getMarket(symbol) {
    const markets = await this.listMarkets()
    return markets.find((market) => market.symbol === symbol.toUpperCase()) ?? null
  },

  async getSnapshot(symbol, timeframe) {
    if (!isMarketDataProviderConfigured()) {
      return disconnectedSnapshot(LIVE_MARKET_UNAVAILABLE)
    }
    if (!isBinanceSymbol(symbol)) {
      return disconnectedSnapshot(
        REAL_MARKET_UNAVAILABLE,
      )
    }
    if (!toBinanceInterval(timeframe) || !BINANCE_TIMEFRAMES.includes(timeframe)) {
      return disconnectedSnapshot(
        REAL_MARKET_UNAVAILABLE,
      )
    }

    const feed = getBinanceMarketFeed()
    try {
      const candles = await feed.fetchKlines(symbol, timeframe)
      const last = candles[candles.length - 1]!
      const bidAsk = feed.getBidAsk(symbol)
      const lastTick: Tick = {
        symbol: symbol.toUpperCase(),
        price: last.close,
        timestamp: Date.now(),
        isSimulated: false,
        feedLabel: REAL_FEED_LABEL,
        bid: bidAsk.bid,
        ask: bidAsk.ask,
      }
      const liveStatus = feed.getStatus()
      const status: ConnectionStatus =
        liveStatus === 'live'
          ? 'live'
          : liveStatus === 'connecting' || liveStatus === 'reconnecting' || liveStatus === 'error'
            ? liveStatus
            : 'connecting'
      return {
        status,
        candles,
        lastTick,
        note: REAL_FEED_LABEL,
        isSimulated: false,
        feedLabel: REAL_FEED_LABEL,
        bid: bidAsk.bid,
        ask: bidAsk.ask,
        lastUpdateAt: feed.getLastMessageAt() ?? lastTick.timestamp,
      }
    } catch (err) {
      reportBackendIssue('market_data', 'binance.snapshot', err)
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
  },

  subscribeTicks(symbol, onTick) {
    if (!isMarketDataProviderConfigured() || !isBinanceSymbol(symbol)) {
      return () => undefined
    }
    const feed = getBinanceMarketFeed()
    const handler: LiveCandleHandler = (update) => {
      onTick(update.tick)
    }
    return feed.subscribeLive(symbol, '1m', handler)
  },

  subscribeLive(symbol, timeframe, onUpdate) {
    if (!isMarketDataProviderConfigured() || !isBinanceSymbol(symbol)) {
      return () => undefined
    }
    if (!toBinanceInterval(timeframe)) {
      return () => undefined
    }
    return getBinanceMarketFeed().subscribeLive(symbol, timeframe, onUpdate)
  },

  onConnectionStatus(handler) {
    if (!isMarketDataProviderConfigured()) {
      handler('disconnected', 'Market data provider not configured')
      return () => undefined
    }
    return getBinanceMarketFeed().onStatus(handler)
  },
}

export function createDisconnectedRealProvider(markets: Market[]): MarketDataProvider {
  return {
    id: 'real-disconnected',
    isSimulated: false,
    getStatus: () => 'disconnected',
    listMarkets: async () => markets,
    getMarket: async (symbol) => markets.find((m) => m.symbol === symbol) ?? null,
    getSnapshot: async () =>
      disconnectedSnapshot(LIVE_MARKET_UNAVAILABLE),
    subscribeTicks: () => () => undefined,
  }
}
