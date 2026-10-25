import { useEffect, useState, useSyncExternalStore } from 'react'
import { digitOfTick } from '@/domain/digit-stats'
import { createTradeResultAnimator, type TradeResultAnimationState } from '@/features/trading/trade-result-animation'
import type { AccountMode, Tick, Trade } from '@/types'

export function useTradeResultAnimation({
  kind,
  trades,
  ticks,
  symbol,
}: {
  kind: AccountMode
  trades: readonly Trade[]
  ticks: readonly Tick[]
  symbol: string
}): TradeResultAnimationState {
  const [animator] = useState(() => createTradeResultAnimator())
  const latestTick = ticks.length > 0 ? ticks[ticks.length - 1]! : null
  const pipSize = latestTick?.pipSize ?? null

  useEffect(() => () => animator.dispose(), [animator])

  useEffect(() => {
    animator.setAccountMode(kind)
  }, [animator, kind])

  useEffect(() => {
    if (!latestTick || latestTick.isSimulated) return
    animator.observeDigit(symbol, digitOfTick(latestTick))
  }, [animator, latestTick, symbol])

  useEffect(() => {
    animator.syncTrades(trades, { pipSizeFor: (market) => (market === symbol ? pipSize : null) })
  }, [animator, trades, symbol, pipSize])

  return useSyncExternalStore(animator.subscribe, animator.getState, animator.getState)
}
