import { TRADE_DURATIONS } from '@/domain/digit-contracts'
import type { Bot, Market, Timeframe } from '@/types'

export const APP_NAME = 'SmartBaseBinary'

export const NOT_CONNECTED = 'This is unavailable right now. Try again in a moment.'

export const RISK_DISCLAIMER =
  'Binary contracts involve a high risk of losing the stake you place. Past or historical results, if shown later, are not a guarantee of future outcomes. SmartBaseBinary does not promise profits, win rates, or payout percentages. Never trade money you cannot afford to lose.'

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d']

export const DURATIONS = TRADE_DURATIONS

const CATALOG_FEED = 'Catalog only — no live quote'
const DIGIT_CONTRACTS = ['EVEN_ODD', 'MATCH_DIFFER', 'OVER_UNDER'] as const

export const MARKET_CATALOG: Market[] = [
  { symbol: 'R_10', displayName: 'Volatility 10', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [15_000, 30_000, 60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: '1HZ10V', displayName: 'Volatility 10 (1s)', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [2_000, 15_000, 30_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: 'R_25', displayName: 'Volatility 25', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [15_000, 30_000, 60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: '1HZ25V', displayName: 'Volatility 25 (1s)', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [2_000, 15_000, 30_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: 'R_50', displayName: 'Volatility 50', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [15_000, 30_000, 60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: 'R_75', displayName: 'Volatility 75', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [15_000, 30_000, 60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: '1HZ75V', displayName: 'Volatility 75 (1s)', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [2_000, 15_000, 30_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: 'R_100', displayName: 'Volatility 100', category: 'synthetic', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [15_000, 30_000, 60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: 'frxEURUSD', displayName: 'EUR/USD', category: 'forex', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
  { symbol: 'frxGBPUSD', displayName: 'GBP/USD', category: 'forex', contractKinds: [...DIGIT_CONTRACTS], durationsMs: [60_000, 300_000], lastPrice: null, priceStatus: 'disconnected', feedLabel: CATALOG_FEED, isSimulated: false },
]

export const BOT_CATALOG: Bot[] = [
  {
    id: 'parity-filter',
    name: 'Parity Filter',
    marketSymbol: 'R_75',
    description: 'Even/odd contract filter with a configurable loss-streak stop. Does not claim a win rate.',
    riskLevel: 'medium',
    defaultStake: 1,
    takeProfit: null,
    stopLoss: null,
    maxRuns: 20,
    lossStreakLimit: 3,
  },
  {
    id: 'range-anchor',
    name: 'Range Anchor',
    marketSymbol: 'R_50',
    description: 'Over/under range filter. Stops on take-profit, stop-loss, or max runs.',
    riskLevel: 'low',
    defaultStake: 1,
    takeProfit: null,
    stopLoss: null,
    maxRuns: 15,
    lossStreakLimit: 2,
  },
  {
    id: 'digit-gate',
    name: 'Digit Gate',
    marketSymbol: 'R_100',
    description: 'Matches/differs digit filter. Manual start and stop only in this UI phase.',
    riskLevel: 'high',
    defaultStake: 1,
    takeProfit: null,
    stopLoss: null,
    maxRuns: 10,
    lossStreakLimit: 2,
  },
  {
    id: 'pulse-window',
    name: 'Pulse Window',
    marketSymbol: '1HZ25V',
    description: 'Short-duration digit contracts on 1-second synthetic indices.',
    riskLevel: 'high',
    defaultStake: 1,
    takeProfit: null,
    stopLoss: null,
    maxRuns: 25,
    lossStreakLimit: 4,
  },
  {
    id: 'drift-watch',
    name: 'Drift Watch',
    marketSymbol: 'R_10',
    description: 'Conservative under-threshold watcher with a tight loss-streak cap.',
    riskLevel: 'low',
    defaultStake: 1,
    takeProfit: null,
    stopLoss: null,
    maxRuns: 12,
    lossStreakLimit: 2,
  },
  {
    id: 'breakout-rail',
    name: 'Breakout Rail',
    marketSymbol: 'R_25',
    description: 'Over-threshold breakout filter. Risk controls are required before a real engine is connected.',
    riskLevel: 'medium',
    defaultStake: 1,
    takeProfit: null,
    stopLoss: null,
    maxRuns: 18,
    lossStreakLimit: 3,
  },
]

export const APP_TOP_NAV = [
  { to: '/app/trade', label: 'Trade', icon: 'trade' as const, inlineFrom: 'md' as const },
  { to: '/app/history', label: 'Trade History', icon: 'history' as const, inlineFrom: 'xl' as const },
  { to: '/app/transactions', label: 'Transactions', icon: 'tx' as const, inlineFrom: 'xl' as const },
  { to: '/app/support', label: 'Support', icon: 'support' as const, inlineFrom: 'xl' as const },
] as const

export const APP_DRAWER_NAV = [
  { to: '/app/trade', label: 'Trade', icon: 'trade' as const },
  { to: '/app/history', label: 'Trade History', icon: 'history' as const },
  { to: '/app/transactions', label: 'Transactions', icon: 'tx' as const },
  { to: '/app/notifications', label: 'Notifications', icon: 'bell' as const },
  { to: '/app/support', label: 'Support', icon: 'support' as const },
] as const

export const PROFILE_MENU_NAV = [
  { to: '/app/profile', label: 'Profile', icon: 'profile' as const },
] as const

export const STAKE_PRESETS = [1, 5, 10, 25, 50, 100] as const

export const ADMIN_NAV = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/verification', label: 'Verification' },
  { to: '/admin/support', label: 'Support' },
  { to: '/admin/withdrawals', label: 'Withdrawals' },
  { to: '/admin/deposits', label: 'Deposits' },
  { to: '/admin/stk-queue', label: 'STK queue' },
  { to: '/admin/megapay', label: 'MegaPay' },
  { to: '/admin/ledger', label: 'Ledger' },
  { to: '/admin/trades', label: 'Trades' },
  { to: '/admin/fees', label: 'Fees' },
  { to: '/admin/withdraw-controls', label: 'Withdrawal controls' },
  { to: '/admin/trade-settings', label: 'Trade settings' },
  { to: '/admin/markets', label: 'Markets' },
  { to: '/admin/notifications', label: 'Notifications' },
  { to: '/admin/audit', label: 'Audit log' },
  { to: '/admin/system', label: 'System health' },
] as const

/** Shown in the admin nav only when public.is_superadmin() says yes. */
export const SUPERADMIN_NAV = { to: '/admin/superadmin', label: 'Superadmin' } as const
