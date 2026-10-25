import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  TickMarkType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { ProgressTrack } from '@/components/ProgressLoader'
import { cn } from '@/lib/cn'
import { TIMEFRAMES } from '@/lib/constants'
import { recordAppError } from '@/lib/error-log'
import { pipDecimals } from '@/lib/format'
import { PALETTE } from '@/lib/palette'
import { candlesToChart, candlesToCloseLine, ticksToChartLine } from '@/domain/chart-data'
import {
  selectChartMode,
  selectChartStyle,
  type ChartMode,
  type ChartSelection,
  type ChartStyle,
} from '@/domain/chart-selection'
import type { Candle, ConnectionStatus, Tick } from '@/types'

export type { ChartMode, ChartSelection, ChartStyle }

const NOTICE_MS = 8000

export type ChartPriceLine = { price: number; label: string; tone: 'call' | 'put' | 'signal' }

const COLORS = {
  text: PALETTE.mist,
  grid: PALETTE.grid,
  border: PALETTE.line,
  signal: PALETTE.signal,
  call: PALETTE.call,
  put: PALETTE.put,
}

const CHART_STYLES: Array<{ id: ChartStyle; label: string }> = [
  { id: 'line', label: 'Line' },
  { id: 'candles', label: 'Candles' },
  { id: 'ohlc', label: 'OHLC' },
]

export function timeframeLabel(mode: ChartMode): string {
  if (mode === 'ticks') return 'Tick'
  if (mode === '1d') return '1D'
  return mode
}

function toDate(time: Time): Date {
  if (typeof time === 'number') return new Date(time * 1000)
  if (typeof time === 'string') return new Date(time)
  return new Date(time.year, time.month - 1, time.day)
}

function localTickMark(time: Time, type: TickMarkType): string {
  const date = toDate(time)
  switch (type) {
    case TickMarkType.Year:
      return String(date.getFullYear())
    case TickMarkType.Month:
      return date.toLocaleDateString(undefined, { month: 'short' })
    case TickMarkType.DayOfMonth:
      return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    case TickMarkType.TimeWithSeconds:
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    default:
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
}

export function PriceChart({
  mode,
  chartStyle = 'line',
  onSelectionChange,
  ticks,
  candles,
  status,
  pipSize = null,
  loading = false,
  error = null,
  compact = false,
  marketLabel,
  symbol,
  lastUpdateAt = null,
  unavailableNote = null,
  priceLines = [],
  toolbarStart,
  footer,
}: {
  mode: ChartMode
  chartStyle?: ChartStyle
  onSelectionChange: (next: ChartSelection) => void
  ticks: Tick[]
  candles: Candle[]
  status: ConnectionStatus
  pipSize?: number | null
  loading?: boolean
  error?: string | null
  compact?: boolean
  marketLabel?: string
  symbol?: string
  lastUpdateAt?: number | null
  unavailableNote?: string | null
  priceLines?: ChartPriceLine[]
  toolbarStart?: ReactNode
  footer?: ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const barRef = useRef<ISeriesApi<'Bar'> | null>(null)
  const linesRef = useRef<Array<{ series: ISeriesApi<SeriesType>; line: IPriceLine }>>([])
  const fittedKeyRef = useRef<string>('')
  const renderedRef = useRef<{ key: string; dataKey: string; firstTime: number; length: number }>({
    key: '',
    dataKey: '',
    firstTime: 0,
    length: 0,
  })
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (status === 'live' || status === 'simulated' || status === 'connecting' || status === 'reconnecting') {
      return
    }
    recordAppError({
      area: 'market_data',
      operation: 'chart.feed',
      code: status,
      message: symbol
        ? `Chart feed ${status} for ${symbol}`
        : `Chart feed ${status}`,
    })
  }, [status, symbol])

  const isTicks = mode === 'ticks'
  const effectiveStyle: ChartStyle = isTicks ? 'line' : chartStyle
  const decimals = pipDecimals(pipSize) ?? 2
  const lineData = useMemo(
    () => (isTicks ? ticksToChartLine(ticks) : effectiveStyle === 'line' ? candlesToCloseLine(candles) : []),
    [isTicks, effectiveStyle, ticks, candles],
  )
  const candleData = useMemo(() => (isTicks ? [] : candlesToChart(candles)), [isTicks, candles])
  const pointCount = isTicks ? lineData.length : candleData.length
  const dataKey = `${mode}|${symbol ?? marketLabel ?? ''}`
  const seriesKey = `${dataKey}|${effectiveStyle}`

  function chooseStyle(style: ChartStyle) {
    const next = selectChartStyle({ mode, style: effectiveStyle }, style)
    if (next.mode !== mode) {
      setNotice(`${style === 'ohlc' ? 'OHLC' : 'Candles'} need a timeframe — switched Tick to ${timeframeLabel(next.mode)}`)
    }
    if (next.mode !== mode || next.style !== chartStyle) onSelectionChange(next)
  }

  function chooseMode(nextMode: ChartMode) {
    const next = selectChartMode({ mode, style: chartStyle }, nextMode)
    if (nextMode === 'ticks' && chartStyle !== 'line') setNotice('Tick view uses a line chart')
    if (next.mode !== mode || next.style !== chartStyle) onSelectionChange(next)
  }

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const chart = createChart(wrap, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: COLORS.text,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 4,
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: localTickMark,
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        timeFormatter: (time: Time) => toDate(time).toLocaleString(),
      },
    })
    chartRef.current = chart
    lineRef.current = chart.addSeries(LineSeries, {
      color: COLORS.signal,
      lineWidth: 2,
      priceLineColor: COLORS.signal,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
      priceLineVisible: true,
      lastPriceAnimation: 0,
      crosshairMarkerRadius: 3,
    })
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.call,
      downColor: COLORS.put,
      borderUpColor: COLORS.call,
      borderDownColor: COLORS.put,
      wickUpColor: COLORS.call,
      wickDownColor: COLORS.put,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
      visible: false,
    })
    barRef.current = chart.addSeries(BarSeries, {
      upColor: COLORS.call,
      downColor: COLORS.put,
      thinBars: false,
      openVisible: true,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
      visible: false,
    })
    const fitToArea = () => {
      const width = wrap.clientWidth
      const height = wrap.clientHeight
      if (width < 2 || height < 2) return
      chart.resize(width, height)
    }
    const observer = new ResizeObserver(fitToArea)
    observer.observe(wrap)
    window.addEventListener('resize', fitToArea)
    window.visualViewport?.addEventListener('resize', fitToArea)
    fitToArea()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fitToArea)
      window.visualViewport?.removeEventListener('resize', fitToArea)
      linesRef.current = []
      chart.remove()
      chartRef.current = null
      lineRef.current = null
      candleRef.current = null
      barRef.current = null
      fittedKeyRef.current = ''
      renderedRef.current = { key: '', dataKey: '', firstTime: 0, length: 0 }
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    chart.applyOptions({
      timeScale: {
        secondsVisible: isTicks,
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          if (isTicks && (type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds)) {
            return toDate(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          }
          return localTickMark(time, type)
        },
      },
    })
  }, [isTicks])

  useEffect(() => {
    const format = { type: 'price' as const, precision: decimals, minMove: 10 ** -decimals }
    lineRef.current?.applyOptions({ priceFormat: format })
    candleRef.current?.applyOptions({ priceFormat: format })
    barRef.current?.applyOptions({ priceFormat: format })
  }, [decimals])

  useEffect(() => {
    const chart = chartRef.current
    const line = lineRef.current
    const candle = candleRef.current
    const bar = barRef.current
    if (!chart || !line || !candle || !bar) return
    const data = effectiveStyle === 'line' ? lineData : candleData
    const prev = renderedRef.current
    const firstTime = data[0]?.time ?? 0
    const keptRange =
      prev.dataKey === dataKey && prev.key !== seriesKey && prev.length > 0
        ? chart.timeScale().getVisibleLogicalRange()
        : null
    line.applyOptions({ visible: effectiveStyle === 'line' })
    candle.applyOptions({ visible: effectiveStyle === 'candles' })
    bar.applyOptions({ visible: effectiveStyle === 'ohlc' })
    const incremental =
      prev.key === seriesKey && prev.length > 0 && firstTime === prev.firstTime && data.length - prev.length <= 1 && data.length >= prev.length
    if (effectiveStyle === 'line') {
      if (incremental && lineData.length > 0) {
        const last = lineData[lineData.length - 1]!
        line.update({ time: last.time as UTCTimestamp, value: last.value })
      } else {
        line.setData(lineData.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })))
        candle.setData([])
        bar.setData([])
      }
    } else {
      const target = effectiveStyle === 'candles' ? candle : bar
      if (incremental && candleData.length > 0) {
        const last = candleData[candleData.length - 1]!
        target.update({ ...last, time: last.time as UTCTimestamp })
      } else {
        target.setData(candleData.map((c) => ({ ...c, time: c.time as UTCTimestamp })))
        line.setData([])
        ;(effectiveStyle === 'candles' ? bar : candle).setData([])
      }
    }
    renderedRef.current = { key: seriesKey, dataKey, firstTime, length: data.length }

    if (keptRange && data.length > 0) {
      chart.timeScale().setVisibleLogicalRange(keptRange)
    } else if (pointCount > 1 && fittedKeyRef.current !== dataKey) {
      fittedKeyRef.current = dataKey
      const visible = isTicks ? 300 : 120
      if (pointCount > visible) {
        chart.timeScale().setVisibleLogicalRange({ from: pointCount - visible, to: pointCount + 4 })
      } else {
        chart.timeScale().fitContent()
      }
    }
  }, [effectiveStyle, isTicks, lineData, candleData, pointCount, seriesKey, dataKey])

  useEffect(() => {
    for (const { series, line } of linesRef.current) series.removePriceLine(line)
    linesRef.current = []
    const series: ISeriesApi<SeriesType> | null =
      effectiveStyle === 'line' ? lineRef.current : effectiveStyle === 'candles' ? candleRef.current : barRef.current
    if (!series) return
    for (const line of priceLines) {
      if (!Number.isFinite(line.price)) continue
      linesRef.current.push({
        series,
        line: series.createPriceLine({
          price: line.price,
          color: COLORS[line.tone],
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: line.label,
        }),
      })
    }
  }, [priceLines, effectiveStyle])

  const empty = pointCount === 0
  const emptyTitle = loading
    ? 'Loading live chart…'
    : error || status === 'disconnected'
      ? 'MARKET DATA UNAVAILABLE'
      : 'Waiting for live market data…'
  const emptyNote = loading ? null : (error ?? unavailableNote)
  const lastLine = lineData[lineData.length - 1]
  const lastCandle = candleData[candleData.length - 1]
  const firstCandle = candleData[0]

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line sbb-chart',
        compact ? '' : 'h-full',
      )}
      data-testid="price-chart"
      data-mode={mode}
      data-style={effectiveStyle}
      data-symbol={symbol ?? ''}
      data-points={pointCount}
      data-last-time={effectiveStyle === 'line' ? (lastLine?.time ?? '') : (lastCandle?.time ?? '')}
      data-last-value={effectiveStyle === 'line' ? (lastLine?.value ?? '') : (lastCandle?.close ?? '')}
      data-first-candle={firstCandle ? JSON.stringify(firstCandle) : ''}
      data-second-candle={candleData[1] ? JSON.stringify(candleData[1]) : ''}
      data-last-candle={lastCandle ? JSON.stringify(lastCandle) : ''}
      data-status={status}
      data-epoch-ms={lastUpdateAt ?? ''}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-2.5 py-1.5">
        {toolbarStart ? <div className="order-1 min-w-0 shrink-0">{toolbarStart}</div> : null}
        <div
          className="order-2 flex shrink-0 rounded-lg border border-line bg-ink-2 p-0.5"
          role="group"
          aria-label="Chart type"
        >
          {CHART_STYLES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={effectiveStyle === item.id}
              title={isTicks && item.id !== 'line' ? `${item.label} use 1m or longer — switches Tick to 1m` : undefined}
              onClick={() => chooseStyle(item.id)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                effectiveStyle === item.id ? 'bg-signal/15 text-signal' : 'text-mist hover:text-paper',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div
          className="order-3 flex min-w-0 flex-1 gap-0.5 overflow-x-auto"
          role="group"
          aria-label="Chart interval"
          data-testid="chart-interval"
        >
          <button
            type="button"
            aria-pressed={mode === 'ticks'}
            onClick={() => chooseMode('ticks')}
            className={cn(
              'shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
              mode === 'ticks' ? 'bg-signal/15 text-signal' : 'text-mist hover:text-paper',
            )}
          >
            Tick
          </button>
          {TIMEFRAMES.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={mode === item}
              onClick={() => chooseMode(item)}
              className={cn(
                'shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
                mode === item ? 'bg-signal/15 text-signal' : 'text-mist hover:text-paper',
              )}
            >
              {timeframeLabel(item)}
            </button>
          ))}
        </div>
        {notice ? (
          <p className="order-5 w-full text-[11px] text-signal" role="status" data-testid="chart-notice">
            {notice}
          </p>
        ) : null}
      </div>
      <div className={cn('relative min-h-0', compact ? 'h-[50vh] min-h-[260px]' : 'min-h-[300px] flex-1')}>
        <div ref={wrapRef} className="absolute inset-0" />
        {empty ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <p className="font-display text-sm font-semibold text-paper">{emptyTitle}</p>
            {loading ? <ProgressTrack className="mt-3 w-40" /> : null}
            {emptyNote ? <p className="mt-1 max-w-sm text-xs text-mist">{emptyNote}</p> : null}
          </div>
        ) : null}
      </div>
      {footer ? <div className="border-t border-line">{footer}</div> : null}
    </div>
  )
}
