import { isValidDigit } from '@/domain/digit-contracts'
import { calculateAccountTradeResult, DEFAULT_WIN_RATE_PERCENT } from '@/domain/outcome'
import type { Trade } from '@/types'

export type SettledResult = 'WIN' | 'LOSS' | 'REFUNDED' | 'OPEN'

export function settledResult(
  trade: Pick<Trade, 'status' | 'contractType' | 'contractOption' | 'selectedDigit' | 'barrier' | 'exitDigit'>,
  winRatePercent: number = DEFAULT_WIN_RATE_PERCENT,
): SettledResult {
  if (trade.status === 'open') return 'OPEN'
  if (trade.status === 'cancelled' || trade.status === 'tie') return 'REFUNDED'
  if (isValidDigit(trade.exitDigit)) {
    return calculateAccountTradeResult(
      trade.exitDigit,
      trade.contractOption,
      trade.selectedDigit,
      trade.barrier,
      winRatePercent,
    )
  }
  return trade.status === 'won' ? 'WIN' : 'LOSS'
}
