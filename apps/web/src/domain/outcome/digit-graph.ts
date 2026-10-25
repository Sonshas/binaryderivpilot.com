import { DEFAULT_WIN_RATE_PERCENT, isAccountWinDigit } from './win-rate.ts'
import type { ContractOption, ContractType } from '@/types'

export function settlementSampleWinRate(sampleSize: number, winCount: number): number | null {
  if (sampleSize <= 0) return null
  return Math.round((winCount / sampleSize) * 10_000) / 100
}

/** Winning digits follow the admin win-rate % (same rule as settlement). */
export function contractDigitWins(
  digit: number,
  _input: {
    contractType: ContractType
    contractOption: ContractOption
    selectedDigit: number
    barrier: number
  },
  winRatePercent: number = DEFAULT_WIN_RATE_PERCENT,
): boolean {
  return isAccountWinDigit(digit, winRatePercent)
}

export function digitSettlesWin(
  digit: number,
  input: {
    contractType: ContractType
    contractOption: ContractOption
    selectedDigit: number
    barrier: number
  },
  winRatePercent: number = DEFAULT_WIN_RATE_PERCENT,
): boolean {
  return contractDigitWins(digit, input, winRatePercent)
}

export function contractSettlementHeadline(
  input: {
    contractType: ContractType
    contractOption: ContractOption
    selectedDigit: number
    barrier: number
  },
  winRatePercent: number = DEFAULT_WIN_RATE_PERCENT,
): string {
  const winning = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((digit) => contractDigitWins(digit, input, winRatePercent))
  const side = input.contractOption.toUpperCase()
  const target =
    input.contractType === 'MATCH_DIFFER'
      ? input.selectedDigit
      : input.contractType === 'OVER_UNDER'
        ? input.barrier
        : ''
  const list = winning.length > 0 ? winning.join(', ') : 'none'
  return `${side}${target === '' ? '' : ` ${target}`} · wins on ${list}`
}

export function winRateNudge(sampleWinPct: number | null, expectedPct = DEFAULT_WIN_RATE_PERCENT): string | null {
  if (sampleWinPct == null) return null
  const target = Math.round(expectedPct * 10) / 10
  const delta = Math.round((sampleWinPct - target) * 10) / 10
  if (Math.abs(delta) < 0.5) return `Sample ${sampleWinPct}% matches ${target}% admin win rate`
  if (delta > 0) return `Sample ${sampleWinPct}% · above ${target}% admin win rate`
  return `Sample ${sampleWinPct}% · below ${target}% admin win rate`
}
