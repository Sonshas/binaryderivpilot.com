export {
  ACCOUNT_WIN_RATE,
  ACCOUNT_WINNING_DIGIT_COUNT,
  DEFAULT_WIN_RATE_PERCENT,
  accountDigitPayoutRate,
  accountWinProbability,
  clampWinRatePercent,
  isAccountWinDigit,
  winningDigitCountForPercent,
} from './win-rate.ts'

export {
  calculateAccountTradeResult,
  countSettlementOutcomes,
  resolveAccountOutcome,
  settleDigitContract,
  type AccountContractResult,
  type AccountOutcome,
} from './settle.ts'

export {
  expectedSettlementWins,
  settlementLossCount,
  settlementWinCount,
  settlementWinRate,
} from './digit-visual.ts'
