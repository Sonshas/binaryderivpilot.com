import { ACCOUNT_WIN_RATE, DEFAULT_WIN_RATE_PERCENT, isAccountWinDigit } from './win-rate.ts'

export function settlementWinCount(
  digits: readonly number[],
  winRatePercent: number = DEFAULT_WIN_RATE_PERCENT,
): number {
  let wins = 0
  for (const digit of digits) {
    if (Number.isInteger(digit) && digit >= 0 && digit <= 9 && isAccountWinDigit(digit, winRatePercent)) wins += 1
  }
  return wins
}

export function settlementLossCount(
  digits: readonly number[],
  winRatePercent: number = DEFAULT_WIN_RATE_PERCENT,
): number {
  let losses = 0
  for (const digit of digits) {
    if (Number.isInteger(digit) && digit >= 0 && digit <= 9 && !isAccountWinDigit(digit, winRatePercent)) losses += 1
  }
  return losses
}

export function settlementWinRate(
  digits: readonly number[],
  winRatePercent: number = DEFAULT_WIN_RATE_PERCENT,
): number {
  const wins = settlementWinCount(digits, winRatePercent)
  const losses = settlementLossCount(digits, winRatePercent)
  const total = wins + losses
  return total > 0 ? wins / total : 0
}

export function expectedSettlementWins(n: number, winRatePercent: number = DEFAULT_WIN_RATE_PERCENT): number {
  return Math.round(n * (winRatePercent / 100 || ACCOUNT_WIN_RATE))
}
