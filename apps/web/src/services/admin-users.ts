import { getSupabase } from '@/lib/supabase'
import { edgeErrorMessage } from '@/services/system-issues'

const FUNCTION = 'admin-users'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

async function invoke<T>(body: Record<string, unknown>): Promise<Result<T>> {
  const client = getSupabase()
  if (!client) return { ok: false, error: 'Supabase is not configured.' }
  const action = String(body.action ?? 'unknown')
  const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, {
    method: 'POST',
    body,
  })
  if (error) {
    const context = (error as { context?: Response }).context
    const status = context?.status
    if (status === 401 || status === 403) {
      try {
        const payload = (await context!.clone().json()) as { error?: string }
        return { ok: false, error: payload.error || 'Forbidden' }
      } catch {
        return { ok: false, error: 'Forbidden' }
      }
    }
    return {
      ok: false,
      error: await edgeErrorMessage(error, 'Admin request failed.', {
        area: 'admin',
        operation: `admin-users.${action}`,
      }),
    }
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, error: await edgeErrorMessage(new Error('Empty admin-users response'), 'Admin request failed.', {
      area: 'admin',
      operation: `admin-users.${action}`,
    }) }
  }
  if (typeof (data as { error?: string }).error === 'string') {
    return { ok: false, error: String((data as { error: string }).error) }
  }
  return { ok: true, data: data as T }
}

export interface AdminUserListRow {
  id: string
  email: string | null
  name: string | null
  phone: string
  country: string
  role: string
  account_status: string
  live_trading_enabled: boolean
  deposits_enabled: boolean
  withdrawals_enabled: boolean
  win_rate_percent: number | null
  is_vip: boolean
  withdraw_gates_cleared: boolean
  kyc_status: string
  created_at: string
  available_usd: number
  locked_usd: number
  balance_usd: number
  collected_usd: number
  collected_kes: number
  collected_count: number
  open_withdrawals: number
  pending_deposits: number
  trade_count: number
}

export const adminUsersService = {
  list: () => invoke<{ users: AdminUserListRow[] }>({ action: 'list' }),
  get: (userId: string) => invoke<Record<string, unknown>>({ action: 'get', user_id: userId }),
  update: (userId: string, patch: Record<string, unknown>) =>
    invoke<{ ok: boolean }>({ action: 'update', user_id: userId, ...patch }),
  adjustBalance: (userId: string, amount: number, note: string) =>
    invoke<{ ok: boolean; wallet?: Record<string, unknown> }>({
      action: 'adjust_balance',
      user_id: userId,
      amount,
      note,
    }),
  notify: (userId: string, title: string, message: string) =>
    invoke<{ ok: boolean }>({ action: 'notify', user_id: userId, title, body: message }),
  kycReview: (userId: string, reviewId: string, status: 'approved' | 'rejected', notes?: string) =>
    invoke<{ ok: boolean }>({
      action: 'kyc_review',
      user_id: userId,
      review_id: reviewId,
      status,
      notes,
    }),
  auditList: (userId?: string) =>
    invoke<{ rows: Record<string, unknown>[] }>({ action: 'audit_list', user_id: userId }),
  marketsList: () => invoke<{ markets: Record<string, unknown>[] }>({ action: 'markets_list' }),
  marketsUpdate: (symbol: string, patch: Record<string, unknown>) =>
    invoke<{ ok: boolean }>({ action: 'markets_update', symbol, ...patch }),
  serviceFees: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'service_fees' }),
  stkQueue: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'stk_queue' }),
  megapayEvents: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'megapay_events' }),
  depositsList: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'deposits_list' }),
  tradesList: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'trades_list' }),
  ledgerList: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'ledger_list' }),
  supportList: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'support_list' }),
  supportReply: (ticketId: string, message: string) =>
    invoke<{ ok: boolean }>({ action: 'support_reply', ticket_id: ticketId, message }),
  supportClose: (ticketId: string) => invoke<{ ok: boolean }>({ action: 'support_close', ticket_id: ticketId }),
  notificationsList: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'notifications_list' }),
  notifyBroadcast: (title: string, body: string) =>
    invoke<{ ok: boolean; count?: number }>({ action: 'notify_broadcast', title, body }),
  kycList: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'kyc_list' }),
}
