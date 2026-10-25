export const DEFAULT_WIN_RATE_PERCENT = 90

export const ACCOUNT_WIN_RATE = DEFAULT_WIN_RATE_PERCENT / 100

export function clampWinRatePercent(value: unknown, fallback = DEFAULT_WIN_RATE_PERCENT): number {
  const amount = Math.round(Number(value) * 100) / 100
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) return fallback
  return amount
}

/** How many of digits 0–9 win for this admin win-rate % (0–10). */
export function winningDigitCountForPercent(winRatePercent: number = DEFAULT_WIN_RATE_PERCENT): number {
  const pct = clampWinRatePercent(winRatePercent)
  return Math.max(0, Math.min(10, Math.round(pct / 10)))
}

export const ACCOUNT_WINNING_DIGIT_COUNT = winningDigitCountForPercent(DEFAULT_WIN_RATE_PERCENT)

export function accountWinProbability(winRatePercent: number = DEFAULT_WIN_RATE_PERCENT): number {
  return winningDigitCountForPercent(winRatePercent) / 10
}

export function accountDigitPayoutRate(winRatePercent: number = DEFAULT_WIN_RATE_PERCENT): number {
  const n = winningDigitCountForPercent(winRatePercent)
  if (n <= 0) return 0
  return Math.floor(((95 - 10 * n) * 1000) / n) / 10000
}

/** Digits `0 .. n-1` win under the admin win-rate rule. */
export function isAccountWinDigit(
  finalDigit: number,
  winRatePercent: number = DEFAULT_WIN_RATE_PERCENT,
): boolean {
  if (!Number.isInteger(finalDigit) || finalDigit < 0 || finalDigit > 9) return false
  return finalDigit < winningDigitCountForPercent(winRatePercent)
}
