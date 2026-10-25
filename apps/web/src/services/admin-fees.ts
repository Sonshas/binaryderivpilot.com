import type {
  DepositFeeSettings,
  HostFeeSettings,
  TradingFeeSettings,
  WithdrawalFeeSettings,
} from '@/domain/payment-settings'
import { DEFAULT_TRADE_PAYOUT_PERCENT } from '@/domain/payment-settings'
import { getSupabase } from '@/lib/supabase'
import { saveTradeSettings } from '@/lib/trade-settings'
import { reportBackendIssue } from '@/services/system-issues'

const FUNCTION = 'admin-fees'
const LOCAL_FEES_KEY = 'sbb.admin.fees'
const RATE_REVISION = 1

export const DEPOSIT_KES_PER_USD = 134
export const WITHDRAW_KES_PER_USD = 125

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface AdminFeesState {
  host: HostFeeSettings
}

export interface AdminFeesSaveInput {
  deposit: DepositFeeSettings
  withdrawal: WithdrawalFeeSettings
  trading: TradingFeeSettings
}

async function functionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response } | null)?.context
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.clone().json()) as { error?: string; message?: string }
      if (body.error || body.message) return String(body.error ?? body.message)
    } catch {
    }
  }
  return 'Could not load fees.'
}

function money(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function mapHost(raw: unknown): HostFeeSettings {
  const host = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const deposit = (host.deposit && typeof host.deposit === 'object' ? host.deposit : {}) as Record<string, unknown>
  const withdrawal = (host.withdrawal && typeof host.withdrawal === 'object' ? host.withdrawal : {}) as Record<
    string,
    unknown
  >
  const trading = (host.trading && typeof host.trading === 'object' ? host.trading : {}) as Record<string, unknown>
  return {
    deposit: {
      kesPerUsd: money(deposit.kesPerUsd, DEPOSIT_KES_PER_USD),
      minKes: money(deposit.minKes, 1600),
      maxKes: money(deposit.maxKes, 150_000),
      quickAmounts: typeof deposit.quickAmounts === 'string' ? deposit.quickAmounts : '1600,2500,5000,10000',
    },
    withdrawal: {
      kesPerUsd: money(withdrawal.kesPerUsd, WITHDRAW_KES_PER_USD),
      minKes: money(withdrawal.minKes, 1000),
      maxKes: money(withdrawal.maxKes, 400_000),
      feeKes: money(withdrawal.feeKes, 0),
    },
    trading: {
      stakeMinUsd: money(trading.stakeMinUsd, 1),
      stakeMaxUsd: money(trading.stakeMaxUsd, 500),
      maxOpenTrades: money(trading.maxOpenTrades, 5),
      dailyProfitLimitUsd: money(trading.dailyProfitLimitUsd, 1000),
      payoutPercent: money(trading.payoutPercent, DEFAULT_TRADE_PAYOUT_PERCENT),
    },
  }
}

function syncLocalPayout(payoutPercent: number): void {
  saveTradeSettings({ payoutPercent })
}

function mapState(data: Record<string, unknown>): AdminFeesState {
  return { host: mapHost(data.host) }
}

function defaultFees(input?: AdminFeesSaveInput): AdminFeesState {
  return {
    host: input
      ? { deposit: input.deposit, withdrawal: input.withdrawal, trading: input.trading }
      : mapHost({}),
  }
}

function readLocalFees(): AdminFeesState | null {
  try {
    const raw = localStorage.getItem(LOCAL_FEES_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AdminFeesSaveInput & { rateRevision?: number }
    if (parsed.rateRevision !== RATE_REVISION && parsed.deposit && parsed.withdrawal) {
      parsed.deposit = { ...parsed.deposit, kesPerUsd: DEPOSIT_KES_PER_USD }
      parsed.withdrawal = { ...parsed.withdrawal, kesPerUsd: WITHDRAW_KES_PER_USD }
      parsed.rateRevision = RATE_REVISION
      localStorage.setItem(LOCAL_FEES_KEY, JSON.stringify(parsed))
    }
    return defaultFees(parsed)
  } catch {
    return null
  }
}

function writeLocalFees(input: AdminFeesSaveInput): AdminFeesState {
  const state = defaultFees(input)
  try {
    localStorage.setItem(LOCAL_FEES_KEY, JSON.stringify({ ...input, rateRevision: RATE_REVISION }))
  } catch {
    return state
  }
  return state
}

export function readSavedHostFees(): HostFeeSettings | null {
  return readLocalFees()?.host ?? null
}

export const adminFeesService = {
  async load(): Promise<Result<AdminFeesState>> {
    const client = getSupabase()
    if (client) {
      const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, { method: 'GET' })
      const status = (error as { context?: Response } | null)?.context?.status
      if (status === 401 || status === 403) return { ok: false, error: await functionError(error) }
      if (!error && data) {
        const state = mapState(data)
        syncLocalPayout(state.host.trading.payoutPercent)
        return { ok: true, data: state }
      }
      if (error) reportBackendIssue('admin', 'admin-fees.load', error, status)
    }
    const local = readLocalFees() ?? defaultFees()
    syncLocalPayout(local.host.trading.payoutPercent)
    return { ok: true, data: local }
  },

  async save(input: AdminFeesSaveInput): Promise<Result<AdminFeesState & { message: string }>> {
    const client = getSupabase()
    if (client) {
      const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, {
        method: 'POST',
        body: {
          deposit: input.deposit,
          withdrawal: input.withdrawal,
          trading: input.trading,
        },
      })
      const status = (error as { context?: Response } | null)?.context?.status
      if (status === 401 || status === 403) return { ok: false, error: await functionError(error) }
      if (!error && data) {
        const state = mapState(data)
        syncLocalPayout(state.host.trading.payoutPercent)
        return {
          ok: true,
          data: {
            ...state,
            message: typeof data.message === 'string' ? data.message : 'Fees saved.',
          },
        }
      }
      if (error) reportBackendIssue('admin', 'admin-fees.save', error, status)
    }
    const state = writeLocalFees(input)
    syncLocalPayout(state.host.trading.payoutPercent)
    return { ok: true, data: { ...state, message: 'Fees saved for this site.' } }
  },
}
