import type { RealtimeChannel } from '@supabase/supabase-js'
import { NO_REAL_TRADE_MESSAGE, parseWithdrawalConfig, processingTimeCopy, type WithdrawalMode, type WithdrawalStatus } from '@/domain/withdrawals'
import { edgeErrorMessage, reportBackendIssue } from '@/services/system-issues'
import { actLocalWithdrawal, listLocalWithdrawals, type LocalRealWithdrawal } from '@/lib/real-books'
import { loadDemoSession } from '@/lib/demo-session'
import { getSupabase } from '@/lib/supabase'
import { readSavedHostFees } from '@/services/admin-fees'
import { notifyRealWalletChanged } from '@/lib/real-wallet-events'
import type { Result } from '@/services/megapay'

export const WITHDRAW_UNAVAILABLE = 'Withdrawals temporarily unavailable'
const FUNCTION = 'mpesa-withdraw'
const ADMIN_FUNCTION = 'admin-withdrawals'
export const WITHDRAWAL_POLL_MS = 5000

export interface WithdrawConfig {
  enabled: boolean
  hasRealTrade: boolean
  eligibilityMessage: string | null
  mode: WithdrawalMode
  kesPerUsd: number
  minKes: number
  maxKes: number
  minUsd: number
  feeKes: number
  processingCopy: string
  message: string | null
}

export interface WithdrawalState {
  withdrawalId: string
  reference: string | null
  status: WithdrawalStatus
  provider: string | null
  amountUsd: number
  amountKes: number
  feeKes: number
  netKes: number
  msisdn: string | null
  receipt: string | null
  failureReason: string | null
  createdAt: string
  processingAt: string | null
  completedAt: string | null
  failedAt: string | null
}

export interface AdminWithdrawalRow extends WithdrawalState {
  id: string
  userId: string
  userEmail: string | null
  userName: string | null
  conversationId: string | null
  resultCode: string | null
  resultDesc: string | null
  adminNote: string | null
}

export interface AdminWithdrawalList {
  mode: WithdrawalMode
  feeKes: number
  kesPerUsd: number
  withdrawals: AdminWithdrawalRow[]
}

async function functionError(error: unknown, fallback = WITHDRAW_UNAVAILABLE): Promise<string> {
  return edgeErrorMessage(error, fallback, { area: 'withdrawals', operation: 'edge.withdraw' })
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

export function mapWithdrawalState(raw: Record<string, unknown>): WithdrawalState {
  return {
    withdrawalId: String(raw.withdrawal_id ?? raw.id),
    reference: str(raw.reference),
    status: String(raw.status) as WithdrawalStatus,
    provider: str(raw.provider),
    amountUsd: Number(raw.amount_usd ?? raw.amount),
    amountKes: Number(raw.amount_kes ?? 0),
    feeKes: Number(raw.fee_kes ?? 0),
    netKes: Number(raw.net_kes ?? 0),
    msisdn: str(raw.msisdn),
    receipt: str(raw.receipt ?? raw.mpesa_receipt),
    failureReason: str(raw.failure_reason),
    createdAt: String(raw.created_at ?? ''),
    processingAt: str(raw.processing_at),
    completedAt: str(raw.completed_at),
    failedAt: str(raw.failed_at),
  }
}

function mapAdminRow(raw: Record<string, unknown>): AdminWithdrawalRow {
  const state = mapWithdrawalState(raw)
  return {
    ...state,
    id: state.withdrawalId,
    userId: String(raw.user_id ?? ''),
    userEmail: str(raw.user_email),
    userName: str(raw.user_name),
    conversationId: str(raw.conversation_id),
    resultCode: str(raw.result_code),
    resultDesc: str(raw.result_desc),
    adminNote: str(raw.admin_note),
  }
}

function localAdminRow(row: LocalRealWithdrawal): AdminWithdrawalRow {
  return {
    withdrawalId: row.id,
    reference: row.reference,
    status: row.status,
    provider: 'manual',
    amountUsd: row.amountUsd,
    amountKes: row.amountKes,
    feeKes: row.feeKes,
    netKes: row.netKes,
    msisdn: row.phone,
    receipt: row.receipt,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    processingAt: row.processingAt,
    completedAt: row.completedAt,
    failedAt: row.failedAt,
    id: row.id,
    userId: row.userEmail,
    userEmail: row.userEmail,
    userName: row.userName,
    conversationId: null,
    resultCode: null,
    resultDesc: null,
    adminNote: row.adminNote,
  }
}

function savedWithdrawConfig(): Result<WithdrawConfig> | null {
  if (!loadDemoSession()?.email) return null
  const base = parseWithdrawalConfig({})
  const saved = readSavedHostFees()?.withdrawal
  const kesPerUsd = saved?.kesPerUsd ?? base.kesPerUsd
  const minKes = saved?.minKes ?? base.minKes
  const maxKes = saved?.maxKes ?? base.maxKes
  const feeKes = saved?.feeKes ?? base.feeKes
  return {
    ok: true,
    data: {
      enabled: true,
      hasRealTrade: false,
      eligibilityMessage: NO_REAL_TRADE_MESSAGE,
      mode: base.mode,
      kesPerUsd,
      minKes,
      maxKes,
      minUsd: kesPerUsd > 0 ? minKes / kesPerUsd : 0,
      feeKes,
      processingCopy: processingTimeCopy(base.mode),
      message: null,
    },
  }
}

function localAdminList(status: 'ALL' | 'OPEN' | WithdrawalStatus): AdminWithdrawalList {
  const base = parseWithdrawalConfig({})
  const saved = readSavedHostFees()?.withdrawal
  const config = {
    feeKes: saved?.feeKes ?? base.feeKes,
    kesPerUsd: saved?.kesPerUsd ?? base.kesPerUsd,
  }
  const rows = listLocalWithdrawals().filter((row) => {
    if (status === 'ALL') return true
    if (status === 'OPEN') return row.status === 'PENDING' || row.status === 'PROCESSING'
    return row.status === status
  })
  return {
    mode: 'manual',
    feeKes: config.feeKes,
    kesPerUsd: config.kesPerUsd,
    withdrawals: rows.map(localAdminRow),
  }
}

const MY_COLUMNS =
  'id, amount, status, provider, reference, amount_kes, fee_kes, net_kes, msisdn, mpesa_receipt, failure_reason, created_at, processing_at, completed_at, failed_at'

export const withdrawalService = {
  async getConfig(): Promise<Result<WithdrawConfig>> {
    const client = getSupabase()
    if (!client) return savedWithdrawConfig() ?? { ok: false, error: WITHDRAW_UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, { method: 'GET' })
    if (error || !data) return savedWithdrawConfig() ?? { ok: false, error: await functionError(error) }
    return {
      ok: true,
      data: {
        enabled: data.enabled === true,
        hasRealTrade: data.has_real_trade === true,
        eligibilityMessage: str(data.eligibility_message),
        mode: data.mode === 'daraja_b2c' ? 'daraja_b2c' : 'manual',
        kesPerUsd: Number(data.kes_per_usd),
        minKes: Number(data.min_kes),
        maxKes: Number(data.max_kes),
        minUsd: Number(data.min_usd),
        feeKes: Number(data.fee_kes ?? 0),
        processingCopy: str(data.processing_copy) ?? '',
        message: str(data.message),
      },
    }
  },

  async request(amountUsd: number, phone: string): Promise<Result<WithdrawalState>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: WITHDRAW_UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, {
      method: 'POST',
      body: { amount_usd: amountUsd, phone },
    })
    if (error || !data) return { ok: false, error: await functionError(error) }
    notifyRealWalletChanged()
    return { ok: true, data: mapWithdrawalState(data) }
  },

  async getMine(withdrawalId: string): Promise<Result<WithdrawalState>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: WITHDRAW_UNAVAILABLE }
    const { data, error } = await client.from('withdrawals').select(MY_COLUMNS).eq('id', withdrawalId).maybeSingle()
    if (error) reportBackendIssue('withdrawals', 'withdrawals.read', error)
    if (error || !data) return { ok: false, error: error ? WITHDRAW_UNAVAILABLE : 'Withdrawal not found.' }
    return { ok: true, data: mapWithdrawalState(data as unknown as Record<string, unknown>) }
  },

  /** Latest open (PENDING/PROCESSING) withdrawal for the signed-in user, if any. */
  async getOpenMine(): Promise<Result<WithdrawalState | null>> {
    const client = getSupabase()
    if (!client) {
      const open = listLocalWithdrawals().find((row) => row.status === 'PENDING' || row.status === 'PROCESSING')
      return {
        ok: true,
        data: open
          ? {
              withdrawalId: open.id,
              reference: open.reference,
              status: open.status,
              provider: 'manual',
              amountUsd: open.amountUsd,
              amountKes: open.amountKes,
              feeKes: open.feeKes,
              netKes: open.netKes,
              msisdn: open.phone,
              receipt: open.receipt,
              failureReason: open.failureReason,
              createdAt: open.createdAt,
              processingAt: open.processingAt,
              completedAt: open.completedAt,
              failedAt: open.failedAt,
            }
          : null,
      }
    }
    const { data: sessionData } = await client.auth.getSession()
    const userId = sessionData.session?.user?.id
    if (!userId) return { ok: true, data: null }
    const { data, error } = await client
      .from('withdrawals')
      .select(MY_COLUMNS)
      .eq('user_id', userId)
      .in('status', ['PENDING', 'PROCESSING'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      reportBackendIssue('withdrawals', 'withdrawals.open', error)
      return { ok: false, error: WITHDRAW_UNAVAILABLE }
    }
    return {
      ok: true,
      data: data ? mapWithdrawalState(data as unknown as Record<string, unknown>) : null,
    }
  },

  subscribe(userId: string, onChange: () => void, options: { pollMs?: number; channel?: string } = {}): () => void {
    const client = getSupabase()
    let channel: RealtimeChannel | null = null
    let removed = false
    if (client) {
      // Unique topic every subscribe — reusing a name after React remount / async
      // removeChannel returns the still-subscribed channel and .on() then throws
      // "cannot add postgres_changes callbacks after subscribe()".
      const base = options.channel ?? `withdrawals:${userId}`
      const topic = `${base}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
      channel = client
        .channel(topic)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'withdrawals', filter: `user_id=eq.${userId}` },
          () => {
            onChange()
            notifyRealWalletChanged()
          },
        )
        .subscribe()
    }
    const pollMs = options.pollMs ?? WITHDRAWAL_POLL_MS
    const timer = pollMs > 0 ? window.setInterval(onChange, pollMs) : null
    return () => {
      if (removed) return
      removed = true
      if (timer != null) window.clearInterval(timer)
      if (channel && client) void client.removeChannel(channel)
    }
  },

  async adminList(status: 'ALL' | 'OPEN' | WithdrawalStatus = 'ALL'): Promise<Result<AdminWithdrawalList>> {
    const client = getSupabase()
    if (client) {
      const { data, error } = await client.functions.invoke<Record<string, unknown>>(ADMIN_FUNCTION, {
        method: 'POST',
        body: { action: 'list', status },
      })
      if (!error && data) {
        const rows = Array.isArray(data.withdrawals) ? (data.withdrawals as Record<string, unknown>[]) : []
        return {
          ok: true,
          data: {
            mode: data.mode === 'daraja_b2c' ? 'daraja_b2c' : 'manual',
            feeKes: Number(data.fee_kes ?? 0),
            kesPerUsd: Number(data.kes_per_usd ?? 0),
            withdrawals: rows.map(mapAdminRow),
          },
        }
      }
    }
    return { ok: true, data: localAdminList(status) }
  },

  async adminAct(
    action: 'processing' | 'complete' | 'fail',
    id: string,
    extra: { receipt?: string; reason?: string; note?: string } = {},
  ): Promise<Result<AdminWithdrawalRow | null>> {
    const client = getSupabase()
    if (client) {
      const { data, error } = await client.functions.invoke<Record<string, unknown>>(ADMIN_FUNCTION, {
        method: 'POST',
        body: { action, id, ...extra },
      })
      if (!error && data) {
        const row = data.withdrawal && typeof data.withdrawal === 'object' ? mapAdminRow(data.withdrawal as Record<string, unknown>) : null
        return { ok: true, data: row }
      }
    }
    const row = actLocalWithdrawal(action, id, extra)
    if (!row) return { ok: false, error: 'Withdrawal not found.' }
    return { ok: true, data: localAdminRow(row) }
  },
}
