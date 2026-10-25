import type { RealtimeChannel } from '@supabase/supabase-js'
import type { PeriodSeries, PeriodSummary } from '@/domain/admin-panel'
import { getSupabase } from '@/lib/supabase'
import type { Result } from '@/services/megapay'

/**
 * Superadmin panel. Reads go through the admin-panel Edge Function, writes through admin_* RPCs; both
 * re-check public.is_superadmin on the server for every call. Nothing here moves real money: the only
 * writable values are users' virtual Demo balances and the Demo win rate (percent).
 */

export interface PanelUser {
  id: string
  email: string | null
  signedUpAt: string
  role: string
  isVip: boolean
  accountStatus: string
  demoBalance: number | null
  demoReportedAt: string | null
  demoPendingAdmin: boolean
  realBalance: number | null
  realCurrency: string
  winRateOverride: number | null
  effectiveWinRate: number
}

export interface PanelAuditRow {
  id: number
  adminEmail: string | null
  action: string
  targetEmail: string | null
  targetUserId: string | null
  oldValue: number | null
  newValue: number | null
  reason: string | null
  createdAt: string
}

export interface PanelWithdrawal {
  id: string
  userEmail: string | null
  amountUsd: number | null
  amountKes: number | null
  status: string
  reference: string | null
  createdAt: string
}

export interface AdminPanelOverview {
  generatedAt: string
  kesPerUsd: number | null
  rateSource: string
  deposits: { summary: PeriodSummary; series: PeriodSeries; recordedKesTotal: number; notCollectedCount: number }
  signups: { summary: PeriodSummary; series: PeriodSeries }
  users: PanelUser[]
  globalWinRate: number
  startingBalance: number
  withdrawals: { byStatus: Record<string, { count: number; usd: number }>; recent: PanelWithdrawal[] }
  audit: PanelAuditRow[]
}

export interface PanelUserDetail {
  realTrades: Record<string, unknown>[]
  withdrawals: Record<string, unknown>[]
  adminEdits: PanelAuditRow[]
}

type Raw = Record<string, unknown>

const DEFAULT_WIN_RATE_PERCENT = 90

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function rows(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter((row): row is Raw => Boolean(row) && typeof row === 'object') : []
}

function summary(value: unknown): PeriodSummary {
  const raw = (value && typeof value === 'object' ? value : {}) as Raw
  const pick = (key: string) => {
    const t = (raw[key] ?? {}) as Raw
    return { count: num(t.count) ?? 0, usd: num(t.usd) ?? 0 }
  }
  return { total: pick('total'), today: pick('today'), week: pick('week'), month: pick('month') }
}

function series(value: unknown): PeriodSeries {
  const raw = (value && typeof value === 'object' ? value : {}) as Raw
  const list = (key: string) =>
    rows(raw[key]).map((p) => ({ label: text(p.label) ?? '', start: text(p.start) ?? '', count: num(p.count) ?? 0, usd: num(p.usd) ?? 0 }))
  return { daily: list('daily'), weekly: list('weekly'), monthly: list('monthly') }
}

export function mapAuditRow(raw: Raw): PanelAuditRow {
  return {
    id: num(raw.id) ?? 0,
    adminEmail: text(raw.admin_email),
    action: text(raw.action) ?? '',
    targetEmail: text(raw.target_email),
    targetUserId: text(raw.target_user_id),
    oldValue: num(raw.old_value),
    newValue: num(raw.new_value),
    reason: text(raw.reason),
    createdAt: text(raw.created_at) ?? '',
  }
}

export function mapOverview(data: Raw): AdminPanelOverview {
  const rate = (data.rate ?? {}) as Raw
  const deposits = (data.deposits ?? {}) as Raw
  const signups = (data.signups ?? {}) as Raw
  const winRate = (data.win_rate ?? {}) as Raw
  const withdrawals = (data.withdrawals ?? {}) as Raw
  const byStatusRaw = (withdrawals.by_status ?? {}) as Record<string, Raw>
  const byStatus: Record<string, { count: number; usd: number }> = {}
  for (const [status, entry] of Object.entries(byStatusRaw)) byStatus[status] = { count: num(entry?.count) ?? 0, usd: num(entry?.usd) ?? 0 }
  const globalWinRate = num(winRate.global) ?? DEFAULT_WIN_RATE_PERCENT
  return {
    generatedAt: text(data.generated_at) ?? '',
    kesPerUsd: num(rate.kes_per_usd),
    rateSource: text(rate.source) ?? '',
    deposits: {
      summary: summary(deposits.summary),
      series: series(deposits.series),
      recordedKesTotal: num(deposits.recorded_kes_total) ?? 0,
      notCollectedCount: num(deposits.not_collected_count) ?? 0,
    },
    signups: { summary: summary(signups.summary), series: series(signups.series) },
    users: rows(data.users).flatMap((u) => {
      const id = text(u.id)
      if (!id) return []
      return [
        {
          id,
          email: text(u.email),
          signedUpAt: text(u.signed_up_at) ?? '',
          role: text(u.role) ?? 'trader',
          isVip: u.is_vip === true,
          accountStatus: text(u.account_status) ?? 'active',
          demoBalance: num(u.demo_balance),
          demoReportedAt: text(u.demo_reported_at),
          demoPendingAdmin: u.demo_pending_admin === true,
          realBalance: num(u.real_balance),
          realCurrency: text(u.real_currency) ?? 'USD',
          winRateOverride: num(u.win_rate_override),
          effectiveWinRate: num(u.effective_win_rate) ?? globalWinRate,
        },
      ]
    }),
    globalWinRate,
    startingBalance: num(data.starting_balance) ?? 10_000,
    withdrawals: {
      byStatus,
      recent: rows(withdrawals.recent).map((w) => ({
        id: text(w.id) ?? '',
        userEmail: text(w.user_email),
        amountUsd: num(w.amount_usd),
        amountKes: num(w.amount_kes),
        status: text(w.status) ?? '',
        reference: text(w.reference),
        createdAt: text(w.created_at) ?? '',
      })),
    },
    audit: rows(data.audit).map(mapAuditRow),
  }
}

async function functionError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: Response } | null)?.context
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.clone().json()) as { error?: string }
      if (body.error) return String(body.error)
    } catch {
      // fall through
    }
  }
  return fallback
}

const RPC_MESSAGES: Record<string, string> = {
  forbidden: 'Only the superadmin can do this.',
  invalid_balance: 'Enter a balance between 0 and 1,000,000,000.',
  invalid_win_rate: 'Enter a win rate between 0% and 100%.',
  user_not_found: 'That user no longer exists.',
  reason_too_long: 'Keep the reason under 500 characters.',
}

export function rpcError(message: string | undefined): string {
  if (!message) return 'Request failed.'
  const key = Object.keys(RPC_MESSAGES).find((k) => message.includes(k))
  return key ? RPC_MESSAGES[key]! : message
}

const UNAVAILABLE = 'This service is temporarily unavailable.'

export const adminPanelService = {
  /** Server-decided: true only for the confirmed allow-listed superadmin account. */
  async isSuperadmin(): Promise<boolean> {
    const client = getSupabase()
    if (!client) return false
    const { data: session } = await client.auth.getSession()
    if (!session.session) return false
    const { data, error } = await client.rpc('is_superadmin')
    return !error && data === true
  },

  async overview(): Promise<Result<AdminPanelOverview>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Raw>('admin-panel', { method: 'POST', body: { action: 'overview' } })
    if (error || !data) return { ok: false, error: await functionError(error, 'Could not load the superadmin panel.') }
    return { ok: true, data: mapOverview(data) }
  },

  async userDetail(userId: string): Promise<Result<PanelUserDetail>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Raw>('admin-panel', {
      method: 'POST',
      body: { action: 'user_detail', user_id: userId },
    })
    if (error || !data) return { ok: false, error: await functionError(error, 'Could not load this user.') }
    return {
      ok: true,
      data: { realTrades: rows(data.real_trades), withdrawals: rows(data.withdrawals), adminEdits: rows(data.admin_edits).map(mapAuditRow) },
    }
  },

  async setDemoBalance(userId: string, balance: number, reason: string): Promise<Result<number>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.rpc('admin_set_demo_balance', {
      p_user_id: userId,
      p_balance: balance,
      p_reason: reason || null,
    })
    if (error) return { ok: false, error: rpcError(error.message) }
    return { ok: true, data: num(Array.isArray(data) ? data[0]?.balance : null) ?? balance }
  },

  async setGlobalWinRate(percent: number, reason: string): Promise<Result<number>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.rpc('admin_set_global_win_rate', { p_percent: percent, p_reason: reason || null })
    if (error) return { ok: false, error: rpcError(error.message) }
    return { ok: true, data: num(data) ?? percent }
  },

  /** percent null clears the override (user follows the global rate). */
  async setUserWinRate(userId: string, percent: number | null, reason: string): Promise<Result<number | null>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.rpc('admin_set_user_win_rate', {
      p_user_id: userId,
      p_percent: percent,
      p_reason: reason || null,
    })
    if (error) return { ok: false, error: rpcError(error.message) }
    return { ok: true, data: num(data) }
  },

  /** Live updates: any demo balance or override change. RLS limits rows to the superadmin. */
  subscribe(onChange: () => void): () => void {
    const client = getSupabase()
    if (!client) return () => undefined
    const channel: RealtimeChannel = client
      .channel('admin-panel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'simulated_balances' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'simulated_win_rate_overrides' }, onChange)
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  },
}
