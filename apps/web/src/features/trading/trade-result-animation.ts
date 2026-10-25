import {
  calculateTradeResult,
  contractKindOf,
  extractLastDigit,
  isValidDigit,
  lastDigitOfPrice,
  selectionTarget,
} from '@/domain/digit-contracts'
import type { AccountMode, ContractOption, ContractType, Trade } from '@/types'

export type TradeAnimationStatus = 'idle' | 'running' | 'settling' | 'won' | 'lost' | 'refunded'

export interface TradeAnimationSelection {
  contract: ContractType
  side: ContractOption
  digit?: number
  barrier?: number
}

export interface TradeResultAnimationState {
  tradeId: string | null
  status: TradeAnimationStatus
  selection: TradeAnimationSelection | null
  cursorDigit: number | null
  settledDigit: number | null
  result: 'WIN' | 'LOSS' | null
  symbol: string | null
  stake: number | null
  payout: number | null
  profitLoss: number | null
}

export const SETTLE_HOLD_MS = 3_000
export const RESULT_MIN_MS = 1_500
export const RESULT_VISIBLE_MS = 8_000
const FRESH_SLACK_MS = 5_000

export const IDLE_ANIMATION: TradeResultAnimationState = {
  tradeId: null,
  status: 'idle',
  selection: null,
  cursorDigit: null,
  settledDigit: null,
  result: null,
  symbol: null,
  stake: null,
  payout: null,
  profitLoss: null,
}

export function selectionOf(trade: Pick<Trade, 'contractType' | 'contractOption' | 'selectedDigit' | 'barrier'>): TradeAnimationSelection {
  const selection: TradeAnimationSelection = { contract: trade.contractType, side: trade.contractOption }
  if (trade.contractType === 'MATCH_DIFFER' && isValidDigit(trade.selectedDigit)) selection.digit = trade.selectedDigit
  if (trade.contractType === 'OVER_UNDER' && isValidDigit(trade.barrier)) selection.barrier = trade.barrier
  return selection
}

export function predictionLabel(selection: TradeAnimationSelection): string {
  const target = selection.digit ?? selection.barrier
  const kind = contractKindOf(selection.side)
  return target == null ? kind : `${kind} ${target}`
}

export function settledDigitOf(trade: Pick<Trade, 'exitDigit' | 'exitPrice'>, pipSize?: number | null): number | null {
  if (isValidDigit(trade.exitDigit)) return trade.exitDigit
  if (trade.exitPrice == null || !Number.isFinite(trade.exitPrice)) return null
  if (pipSize != null) {
    const digit = extractLastDigit(trade.exitPrice, pipSize)
    if (digit != null) return digit
  }
  return lastDigitOfPrice(trade.exitPrice)
}

export function crossCheckSettledStatus(trade: Trade, settledDigit: number | null): string | null {
  if (trade.status !== 'won' && trade.status !== 'lost') return null
  if (!isValidDigit(settledDigit)) return null
  const kind = contractKindOf(trade.contractOption)
  const target = selectionTarget({
    contractType: trade.contractType,
    contractOption: trade.contractOption,
    selectedDigit: trade.selectedDigit,
    barrier: trade.barrier,
  })
  const expected = calculateTradeResult(kind, target, settledDigit)
  const reported = trade.status === 'won' ? 'WIN' : 'LOSS'
  if (expected === reported) return null
  return `Trade ${trade.id}: UI settlement check disagrees with stored status (${trade.status}) on digit ${settledDigit}. Showing the stored status.`
}

export interface TradeResultAnimatorOptions {
  now?: () => number
  warn?: (message: string) => void
  crossCheck?: boolean
}

export interface SyncContext {
  pipSizeFor?: (symbol: string) => number | null | undefined
}

export function createTradeResultAnimator(options: TradeResultAnimatorOptions = {}) {
  const now = options.now ?? (() => Date.now())
  const warn = options.warn ?? ((message: string) => console.warn(message))
  const crossCheck = options.crossCheck ?? import.meta.env.DEV

  let state: TradeResultAnimationState = IDLE_ANIMATION
  let kind: AccountMode | null = null
  let enteredAt = now()
  let seen = new Set<string>()
  let known = new Map<string, Trade>()
  let current: Trade | null = null
  let pendingId: string | null = null
  let resultShownAt: number | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let context: SyncContext = {}
  const liveDigits = new Map<string, number>()
  const listeners = new Set<() => void>()

  function set(next: Partial<TradeResultAnimationState>) {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }

  function schedule(ms: number, fn: () => void) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn()
    }, ms)
  }

  function clearTimer() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function moneyOf(trade: Trade) {
    return { stake: trade.stake, payout: trade.payout, profitLoss: trade.profitLoss }
  }

  function start(trade: Trade) {
    clearTimer()
    current = trade
    pendingId = null
    resultShownAt = null
    const digit = liveDigits.get(trade.symbol)
    state = { ...IDLE_ANIMATION }
    set({
      tradeId: trade.id,
      status: 'running',
      selection: selectionOf(trade),
      symbol: trade.symbol,
      cursorDigit: digit ?? null,
      ...moneyOf(trade),
    })
    if (trade.status !== 'open') settle(trade)
  }

  function settle(trade: Trade) {
    current = trade
    const settledDigit = settledDigitOf(trade, context.pipSizeFor?.(trade.symbol))
    if (trade.status === 'cancelled' || trade.status === 'tie') {
      set({ status: 'refunded', settledDigit, cursorDigit: settledDigit, result: null, ...moneyOf(trade) })
      afterResult()
      return
    }
    set({ status: 'settling', settledDigit, cursorDigit: settledDigit, result: null, ...moneyOf(trade) })
    schedule(SETTLE_HOLD_MS, () => reveal(trade, settledDigit))
  }

  function reveal(trade: Trade, settledDigit: number | null) {
    if (crossCheck) {
      const mismatch = crossCheckSettledStatus(trade, settledDigit)
      if (mismatch) warn(mismatch)
    }
    const result: 'WIN' | 'LOSS' = trade.status === 'won' ? 'WIN' : 'LOSS'
    set({ status: trade.status === 'won' ? 'won' : 'lost', result })
    afterResult()
  }

  function afterResult() {
    resultShownAt = now()
    if (pendingId) schedule(RESULT_MIN_MS, startPending)
    else schedule(RESULT_VISIBLE_MS, () => {
      current = null
      resultShownAt = null
      state = IDLE_ANIMATION
      for (const listener of listeners) listener()
    })
  }

  function startPending() {
    const trade = pendingId ? known.get(pendingId) : undefined
    pendingId = null
    if (trade) start(trade)
  }

  function startOrQueue(trade: Trade) {
    if (state.status === 'settling') {
      pendingId = trade.id
      return
    }
    const showingResult = state.status === 'won' || state.status === 'lost' || state.status === 'refunded'
    if (showingResult && resultShownAt != null && now() - resultShownAt < RESULT_MIN_MS) {
      pendingId = trade.id
      schedule(RESULT_MIN_MS - (now() - resultShownAt), startPending)
      return
    }
    start(trade)
  }

  function createdMs(trade: Trade): number {
    const ms = new Date(trade.createdAt).getTime()
    return Number.isFinite(ms) ? ms : 0
  }

  return {
    getState: () => state,

    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    setAccountMode(next: AccountMode) {
      if (next === kind) return
      kind = next
      enteredAt = now()
      seen = new Set()
      known = new Map()
      current = null
      pendingId = null
      resultShownAt = null
      clearTimer()
      state = IDLE_ANIMATION
      for (const listener of listeners) listener()
    },

    syncTrades(trades: readonly Trade[], ctx: SyncContext = {}) {
      context = ctx
      const mine = kind ? trades.filter((trade) => trade.walletKind === kind) : trades
      known = new Map(mine.map((trade) => [trade.id, trade]))

      let newest: Trade | null = null
      for (const trade of mine) {
        if (seen.has(trade.id)) continue
        seen.add(trade.id)
        const fresh = trade.status === 'open' || createdMs(trade) >= enteredAt - FRESH_SLACK_MS
        if (fresh && (!newest || createdMs(trade) >= createdMs(newest))) newest = trade
      }
      const followed = pendingId ? known.get(pendingId) ?? null : current
      if (newest && (!followed || createdMs(newest) >= createdMs(followed))) startOrQueue(newest)

      if (current && state.status === 'running') {
        const latest = known.get(current.id)
        if (latest && latest.status !== 'open') settle(latest)
      }
    },

    observeDigit(symbol: string, digit: number | null) {
      if (!isValidDigit(digit)) return
      liveDigits.set(symbol, digit)
      if (state.status === 'running' && state.symbol === symbol && state.cursorDigit !== digit) set({ cursorDigit: digit })
    },

    dispose() {
      clearTimer()
    },
  }
}

export type TradeResultAnimator = ReturnType<typeof createTradeResultAnimator>
