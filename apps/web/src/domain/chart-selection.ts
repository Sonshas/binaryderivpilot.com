import type { Timeframe } from '@/types'

export type ChartMode = 'ticks' | Timeframe
export type ChartStyle = 'line' | 'candles' | 'ohlc'
export type ChartSelection = { mode: ChartMode; style: ChartStyle }

export const CANDLE_FALLBACK_TIMEFRAME: Timeframe = '1m'

export function selectChartStyle(current: ChartSelection, style: ChartStyle): ChartSelection {
  if (style !== 'line' && current.mode === 'ticks') return { mode: CANDLE_FALLBACK_TIMEFRAME, style }
  return { mode: current.mode, style }
}

export function selectChartMode(current: ChartSelection, mode: ChartMode): ChartSelection {
  return { mode, style: mode === 'ticks' ? 'line' : current.style }
}

export function initialChartMode(style: ChartStyle): ChartMode {
  return style === 'line' ? 'ticks' : CANDLE_FALLBACK_TIMEFRAME
}
