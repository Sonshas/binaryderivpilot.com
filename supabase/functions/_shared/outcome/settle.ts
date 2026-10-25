import { DEFAULT_WIN_RATE_PERCENT, isAccountWinDigit } from './win-rate.ts'

export type AccountOutcome = 'won' | 'lost'
export type AccountContractResult = 'WIN' | 'LOSS'

function assertDigit(finalDigit: number): number {
  if (typeof finalDigit !== 'number' || !Number.isInteger(finalDigit) || finalDigit < 0 || finalDigit > 9) {
    throw new RangeError('finalDigit must be an integer from 0 to 9')
  }
  return finalDigit
}

function isValidDigit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 9
}

/**
 * Admin win-rate rule only — no natural even/odd/match/over logic.
 * Digits 0 .. round(winRatePercent/10)-1 win; the rest lose.
 */
export function resolveAccountOutcome(
  finalDigit: number,
  _contractOption?: string | null,
  _selectedDigit?: number | null,
  _barrier?: number | null,
  winRatePercent: number = DEFAULT_WIN_RATE_PERCENT,
): AccountOutcome {
  return isAccountWinDigit(assertDigit(finalDigit), winRatePercent) ? 'won' : 'lost'
}

export function calculateAccountTradeResult(
  finalDigit: number,
  contractOption?: string | null,
  selectedDigit?: number | null,
  barrier?: number | null,
  winRatePercent: number = DEFAULT_WIN_RATE_PERCENT,
): AccountContractResult {
  return resolveAccountOutcome(finalDigit, contractOption, selectedDigit, barrier, winRatePercent) === 'won'
    ? 'WIN'
    : 'LOSS'
}

export function lastDigitOfPrice(price: number): number {
  const raw = Math.abs(price).toFixed(5).replace('.', '').replace(/0+$/, '')
  const digits = raw.length ? raw : '0'
  return Number(digits[digits.length - 1] ?? '0')
}

export { isValidDigit }

export function settleDigitContract(input: {
  contractType?: string
  contractOption?: string
  selectedDigit?: number | null
  barrier?: number | null
  exitPrice: number
  exitDigit?: number | null
  winRatePercent?: number
}): AccountOutcome {
  const digit = isValidDigit(input.exitDigit) ? input.exitDigit : lastDigitOfPrice(input.exitPrice)
  return resolveAccountOutcome(
    digit,
    input.contractOption,
    input.selectedDigit,
    input.barrier,
    input.winRatePercent ?? DEFAULT_WIN_RATE_PERCENT,
  )
}

export function countSettlementOutcomes(
  digits: readonly number[],
  contractOption?: string | null,
  selectedDigit?: number | null,
  barrier?: number | null,
  winRatePercent: number = DEFAULT_WIN_RATE_PERCENT,
): { wins: number; losses: number } {
  let wins = 0
  let losses = 0
  for (const digit of digits) {
    if (!isValidDigit(digit)) continue
    if (resolveAccountOutcome(digit, contractOption, selectedDigit, barrier, winRatePercent) === 'won') wins += 1
    else losses += 1
  }
  return { wins, losses }
}
