import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui'
import { CONTRACT_TYPES } from '@/domain/contracts'
import { lastDigitOfPrice, REAL_TRADE_SYMBOLS } from '@/domain/digit-contracts'
import { bestScanPick, pickLabel } from '@/domain/digit-scanner'
import { scanResultFromPick, volatilityLabelOf, type ScanResult } from '@/domain/prediction'
import { predictionStore } from '@/lib/prediction-store'
import { getSharedDerivFeed } from '@/providers/market-data/deriv-feed'
import { getBufferedTicks } from '@/providers/market-data/tick-buffer'
import { reportBackendIssue } from '@/services/system-issues'
import type { AccountMode, ContractType, Market } from '@/types'

const SCAN_TICKS = 100
const FETCH_TIMEOUT_MS = 4_000
const SCAN_CONCURRENCY = 3

function displayMarketName(market: Market): string {
  return market.displayName?.trim() || market.symbol
}

function digitsFromPrices(prices: readonly number[]): number[] {
  return prices.filter((price) => Number.isFinite(price)).map((price) => lastDigitOfPrice(price))
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function digitsForMarket(symbol: string): Promise<number[]> {
  const buffered = getBufferedTicks(symbol)
  if (buffered.length >= 40) {
    return digitsFromPrices(buffered.slice(-SCAN_TICKS).map((tick) => tick.price))
  }
  try {
    const history = await withTimeout(getSharedDerivFeed().getTicksHistory(symbol, SCAN_TICKS), FETCH_TIMEOUT_MS)
    return digitsFromPrices(history.prices)
  } catch {
    if (buffered.length > 0) return digitsFromPrices(buffered.map((tick) => tick.price))
    return []
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R | null>,
  onProgress: (done: number, item: T) => void,
): Promise<R[]> {
  const out: R[] = []
  let next = 0
  let finished = 0
  async function run() {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]!
      onProgress(finished, item)
      const result = await worker(item, index)
      finished += 1
      onProgress(finished, item)
      if (result != null) out.push(result)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => run()))
  return out
}

export function DigitScanner({
  open,
  onClose,
  markets,
  kind,
  contractType,
  onLoad,
}: {
  open: boolean
  onClose: () => void
  markets: Market[]
  kind: AccountMode
  contractType: ContractType
  onLoad: () => void
}) {
  const [scanType, setScanType] = useState<ContractType>(contractType)
  const [scanning, setScanning] = useState(false)
  const [progressDone, setProgressDone] = useState(0)
  const [progressTotal, setProgressTotal] = useState(0)
  const [progressLabel, setProgressLabel] = useState('Ready to scan')
  const [bestMarket, setBestMarket] = useState('')
  const [prediction, setPrediction] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [scanToken, setScanToken] = useState(0)
  const [hasResult, setHasResult] = useState(false)
  const latestRef = useRef<ScanResult | null>(null)
  const cancelRef = useRef(false)
  const scanTypeRef = useRef(scanType)
  scanTypeRef.current = scanType

  useEffect(() => {
    if (!open) return
    setScanType(contractType)
    setBestMarket('')
    setPrediction('')
    setFailure(null)
    setHasResult(false)
    setProgressDone(0)
    setProgressTotal(0)
    setProgressLabel('Ready to scan')
    latestRef.current = null
    setScanToken((value) => value + 1)
  }, [open, contractType])

  // Symbol set only — not the markets array identity (list refresh every 2s was restarting scans forever).
  const marketKey = markets.map((market) => market.symbol).join(',')
  const marketsRef = useRef(markets)
  marketsRef.current = markets

  useEffect(() => {
    if (!open || scanToken === 0) return
    if (!marketKey) {
      setProgressLabel('Waiting for markets…')
      setScanning(false)
      return
    }
    cancelRef.current = false
    let cancelled = false
    const snapshot = marketsRef.current
    setScanning(true)
    setFailure(null)
    setBestMarket('')
    setPrediction('')
    setHasResult(false)
    latestRef.current = null
    predictionStore.beginScan()

    void (async () => {
      try {
        const allowed = new Set(REAL_TRADE_SYMBOLS as readonly string[])
        const scanMarkets = snapshot.filter((market) => allowed.has(market.symbol))
        const targets = scanMarkets.length > 0 ? scanMarkets : snapshot.slice(0, 10)
        setProgressTotal(targets.length)
        setProgressDone(0)
        setProgressLabel(targets.length ? 'Scanning markets…' : 'No markets available')
        if (targets.length === 0) {
          predictionStore.completeScan(null)
          setFailure('No markets available to scan')
          setScanning(false)
          setProgressLabel('Ready to scan')
          return
        }

        const rows = await mapPool(
          targets,
          SCAN_CONCURRENCY,
          async (market) => {
            if (cancelled || cancelRef.current) return null
            const digits = await digitsForMarket(market.symbol)
            if (digits.length === 0) return null
            return { symbol: market.symbol, digits }
          },
          (done, market) => {
            if (cancelled || cancelRef.current) return
            setProgressDone(done)
            setProgressLabel(displayMarketName(market))
          },
        )
        if (cancelled || cancelRef.current) return

        const activeType = scanTypeRef.current
        const pick = bestScanPick(rows, activeType)
        if (!pick) {
          predictionStore.completeScan(null)
          setFailure('No ticks yet')
          setProgressLabel('Scan complete')
          setScanning(false)
          return
        }
        const market = snapshot.find((item) => item.symbol === pick.symbol)
        const marketName = market ? displayMarketName(market) : pick.symbol
        const result = scanResultFromPick(
          pick,
          volatilityLabelOf(pick.symbol, market?.displayName),
          Date.now(),
          `scan-${Date.now()}`,
          marketName,
        )
        predictionStore.completeScan(result)
        latestRef.current = result
        setBestMarket(marketName)
        setPrediction(pickLabel(pick))
        setHasResult(true)
        setProgressDone(targets.length)
        setProgressLabel('Scan complete')
        setScanning(false)
      } catch (error) {
        if (cancelled || cancelRef.current) return
        reportBackendIssue('scanner', 'digit_scan', error)
        predictionStore.completeScan(null)
        setFailure('Scan could not finish. Please try again.')
        setProgressLabel('Ready to scan')
        setScanning(false)
      }
    })()

    return () => {
      cancelled = true
      cancelRef.current = true
      predictionStore.cancelScan()
    }
  }, [open, scanToken, marketKey])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  const ready = hasResult && !scanning && !failure
  const progressPct = progressTotal > 0 ? Math.min(100, Math.round((progressDone / progressTotal) * 100)) : 0
  const loadLabel = bestMarket ? `Load ${bestMarket}` : 'Load best market'

  function onTradeTypeChange(next: ContractType) {
    if (next === scanType) return
    cancelRef.current = true
    setScanning(false)
    setScanType(next)
    setBestMarket('')
    setPrediction('')
    setFailure(null)
    setHasResult(false)
    latestRef.current = null
    predictionStore.completeScan(null)
    setProgressLabel('Ready to scan')
    setProgressDone(0)
    setProgressTotal(0)
  }

  function onRescan() {
    if (scanning) return
    setScanToken((value) => value + 1)
  }

  function onLoadBest() {
    if (!latestRef.current || scanning) return
    predictionStore.completeScan(latestRef.current)
    predictionStore.load()
    onLoad()
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 sm:items-center" data-kind={kind}>
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-ink-2 p-5 text-paper shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="AI scanner"
        data-testid="digit-scanner"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">AI scanner</h2>
          <button type="button" className="text-sm text-mist hover:text-paper" onClick={onClose} aria-label="Close scanner">
            Close
          </button>
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs text-mist">Trade type</span>
          <select
            className="h-10 w-full rounded-lg border border-line bg-ink px-3 text-sm text-paper outline-none focus:border-signal"
            value={scanType}
            disabled={scanning}
            onChange={(event) => onTradeTypeChange(event.target.value as ContractType)}
            data-testid="scanner-trade-type"
          >
            {CONTRACT_TYPES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.shortLabel}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs text-mist">Best market found</span>
          <input
            type="text"
            readOnly
            value={bestMarket}
            className="h-10 w-full rounded-lg border border-line bg-ink px-3 text-sm text-paper outline-none"
            data-testid="scanner-best-market"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs text-mist">Prediction</span>
          <input
            type="text"
            readOnly
            value={prediction}
            className="h-10 w-full rounded-lg border border-line bg-ink px-3 text-sm text-paper outline-none"
            data-testid="scanner-prediction"
          />
        </label>

        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-mist">
          <span data-testid="scanner-progress-label">{progressLabel}</span>
          <span data-testid="scanner-progress-count">
            {progressDone}/{progressTotal || 0}
          </span>
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
          data-testid="scanner-progress"
        >
          <div className="h-full rounded-full bg-signal transition-[width] duration-150" style={{ width: `${progressPct}%` }} />
        </div>

        {failure ? (
          <p className="mt-3 rounded-lg border border-put/40 bg-put/10 px-3 py-2 text-sm text-paper" role="alert" data-testid="scanner-status">
            {failure}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onRescan} disabled={scanning} data-testid="scanner-rescan">
            {scanning ? 'Scanning…' : 'Scan markets'}
          </Button>
          <Button type="button" onClick={onLoadBest} disabled={!ready} data-testid="load-prediction">
            {loadLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
