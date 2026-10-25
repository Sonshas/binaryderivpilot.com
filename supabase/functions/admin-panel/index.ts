import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { readAllPages } from '../_shared/admin-batch.ts'
import { splitMpesaDeposits, type DepositSource } from '../_shared/admin-dashboard.ts'
import {
  SIMULATED_STARTING_BALANCE,
  effectiveWinRatePercent,
  parseWinRatePercent,
  periodSeries,
  summarizePeriods,
  type DatedAmount,
} from '../_shared/admin-panel.ts'
import { isAdmin } from '../_shared/admin-staff.ts'
import { adminClient, corsHeaders, json, logEdgeError, resolveServerConfig, userFromRequest } from '../_shared/server.ts'

// Superadmin panel reads (verify_jwt on). The caller must be on the ADMIN_EMAILS allow-list AND pass
// public.is_superadmin_user (confirmed email in public.app_admins). Read-only: demo balance and win-rate
// edits go through the admin_* RPCs, which re-check the role.
// POST { action: 'overview' } — deposits, sign-ups, users with demo / real balances, demo win rates,
//   withdrawals overview and the superadmin audit log.
// POST { action: 'user_detail', user_id } — one user's recent real trades, withdrawals and admin edits.

const DEFAULT_WIN_RATE_PERCENT = 90
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEPOSIT_COLUMNS =
  'id, user_id, amount, currency, status, provider, method, mpesa_receipt, callback_amount_kes, details, created_at, updated_at, is_simulated, account_mode'

type Row = Record<string, unknown>

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function paged(admin: SupabaseClient, table: string, columns: string, build?: (q: any) => any): Promise<Row[]> {
  return readAllPages<Row>((from, to) => {
    let query = admin.from(table).select(columns)
    if (build) query = build(query)
    return query.range(from, to)
  })
}

function toDepositSource(row: Row): DepositSource {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    amount: (row.amount as number | string | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    status: (row.status as string | null) ?? null,
    provider: (row.provider as string | null) ?? null,
    method: (row.method as string | null) ?? null,
    mpesa_receipt: (row.mpesa_receipt as string | null) ?? null,
    callback_amount_kes: (row.callback_amount_kes as number | string | null) ?? null,
    details: asRecord(row.details),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    is_simulated: row.is_simulated === true,
    account_mode: (row.account_mode as string | null) ?? null,
  }
}

function auditRow(row: Row, emails: Map<string, string | null>) {
  const before = asRecord(row.before_state) ?? {}
  const after = asRecord(row.after_state) ?? {}
  const userId = text(row.user_id)
  const action = String(row.action ?? '')
  const key = action.startsWith('win_rate.') ? 'win_rate_percent' : 'balance'
  return {
    id: num(row.id) ?? 0,
    admin_email: text(row.actor_email),
    action,
    target_user_id: userId,
    target_email: userId ? (emails.get(userId) ?? null) : null,
    old_value: num(before[key]),
    new_value: num(after[key]),
    reason: text(after.reason),
    created_at: String(row.created_at ?? ''),
  }
}

async function overview(admin: SupabaseClient) {
  const now = Date.now()
  const [cfg, users, deposits, balances, overrides, settings, wallets, withdrawals, audit] = await Promise.all([
    resolveServerConfig(admin),
    paged(admin, 'users', 'id, email, role, created_at, is_vip, account_status', (q) =>
      q.order('created_at', { ascending: false }).order('id', { ascending: true }),
    ),
    paged(admin, 'deposits', DEPOSIT_COLUMNS, (q) =>
      q.eq('account_mode', 'real').eq('is_simulated', false).eq('method', 'mpesa').order('id', { ascending: true }),
    ),
    paged(admin, 'simulated_balances', 'user_id, balance, admin_version, updated_by, reported_at, updated_at', (q) =>
      q.order('user_id', { ascending: true }),
    ),
    paged(admin, 'simulated_win_rate_overrides', 'user_id, win_rate_percent', (q) => q.order('user_id', { ascending: true })),
    admin.from('simulation_settings').select('win_rate_percent, updated_at').eq('id', true).maybeSingle(),
    paged(admin, 'wallets', 'id, user_id, available_balance, currency', (q) =>
      q.eq('account_mode', 'real').eq('is_simulated', false).order('id', { ascending: true }),
    ),
    paged(admin, 'withdrawals', 'id, user_id, amount, amount_kes, status, reference, created_at', (q) =>
      q.eq('account_mode', 'real').eq('is_simulated', false).order('created_at', { ascending: false }).order('id', { ascending: true }),
    ),
    admin
      .from('audit_log')
      .select('id, actor_email, action, user_id, before_state, after_state, created_at')
      .eq('target_type', 'superadmin')
      .order('created_at', { ascending: false })
      .limit(200),
  ])
  if (settings.error) throw new Error(`simulation_settings: ${settings.error.message}`)
  if (audit.error) throw new Error(`audit_log: ${audit.error.message}`)

  const rate = num(cfg.kesPerUsd)
  const emails = new Map(users.map((u) => [String(u.id), text(u.email)]))
  const { collected, other } = splitMpesaDeposits(deposits.map(toDepositSource))
  const depositItems: DatedAmount[] = collected.map((d) => ({
    at: d.credited_at ?? d.created_at,
    usd: d.amount_usd ?? (d.amount_kes != null && rate ? Math.round((d.amount_kes / rate) * 100) / 100 : null),
  }))
  const recordedKes = collected.reduce((sum, d) => sum + (d.amount_kes ?? 0), 0)
  const signupItems: DatedAmount[] = users.map((u) => ({ at: String(u.created_at ?? ''), usd: 0 }))

  const demoById = new Map(balances.map((b) => [String(b.user_id), b]))
  const overrideById = new Map(overrides.map((o) => [String(o.user_id), parseWinRatePercent(o.win_rate_percent)]))
  const realById = new Map(wallets.map((w) => [String(w.user_id), { balance: num(w.available_balance), currency: String(w.currency ?? 'USD') }]))
  const globalRate = parseWinRatePercent(settings.data?.win_rate_percent) ?? DEFAULT_WIN_RATE_PERCENT

  const userRows = users.map((u) => {
    const id = String(u.id)
    const demo = demoById.get(id)
    const override = overrideById.get(id) ?? null
    return {
      id,
      email: text(u.email),
      signed_up_at: String(u.created_at ?? ''),
      role: text(u.role) ?? 'trader',
      is_vip: u.is_vip === true,
      account_status: text(u.account_status) ?? 'active',
      demo_balance: demo ? num(demo.balance) : null,
      demo_reported_at: demo ? text(demo.reported_at) : null,
      demo_pending_admin: demo ? demo.updated_by === 'admin' : false,
      real_balance: realById.get(id)?.balance ?? null,
      real_currency: realById.get(id)?.currency ?? 'USD',
      win_rate_override: override,
      effective_win_rate: effectiveWinRatePercent(override, globalRate, DEFAULT_WIN_RATE_PERCENT),
    }
  })

  const byStatus: Record<string, { count: number; usd: number }> = {}
  for (const w of withdrawals) {
    const status = String(w.status ?? 'UNKNOWN')
    const entry = byStatus[status] ?? { count: 0, usd: 0 }
    entry.count += 1
    entry.usd = Math.round((entry.usd + (num(w.amount) ?? 0)) * 100) / 100
    byStatus[status] = entry
  }

  return {
    generated_at: new Date(now).toISOString(),
    rate: { kes_per_usd: rate, source: 'Deposit rate (payment_settings DEPOSIT_KES_PER_USD, else KES_PER_USD secret)' },
    deposits: {
      summary: summarizePeriods(depositItems, now),
      series: periodSeries(depositItems, now),
      recorded_kes_total: Math.round(recordedKes * 100) / 100,
      not_collected_count: other.length,
    },
    signups: { summary: summarizePeriods(signupItems, now), series: periodSeries(signupItems, now) },
    users: userRows,
    win_rate: { global: globalRate, updated_at: settings.data?.updated_at ?? null },
    starting_balance: SIMULATED_STARTING_BALANCE,
    withdrawals: {
      by_status: byStatus,
      recent: withdrawals.slice(0, 25).map((w) => ({
        id: String(w.id),
        user_email: emails.get(String(w.user_id)) ?? null,
        amount_usd: num(w.amount),
        amount_kes: num(w.amount_kes),
        status: String(w.status ?? ''),
        reference: text(w.reference),
        created_at: String(w.created_at ?? ''),
      })),
    },
    audit: (audit.data ?? []).map((row) => auditRow(row as Row, emails)),
  }
}

async function userDetail(admin: SupabaseClient, userId: string) {
  const [trades, withdrawals, audit, user] = await Promise.all([
    admin
      .from('trades')
      .select('id, symbol, contract_type, contract_option, stake, status, payout, profit_loss, account_mode, created_at')
      .eq('user_id', userId)
      .eq('account_mode', 'real')
      .order('created_at', { ascending: false })
      .limit(20),
    admin
      .from('withdrawals')
      .select('id, amount, amount_kes, status, reference, created_at')
      .eq('user_id', userId)
      .eq('account_mode', 'real')
      .eq('is_simulated', false)
      .order('created_at', { ascending: false })
      .limit(20),
    admin
      .from('audit_log')
      .select('id, actor_email, action, user_id, before_state, after_state, created_at')
      .eq('target_type', 'superadmin')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
    admin.from('users').select('email').eq('id', userId).maybeSingle(),
  ])
  if (trades.error || withdrawals.error || audit.error) throw new Error('user detail query failed')
  const emails = new Map([[userId, text(user.data?.email)]])
  return {
    real_trades: trades.data ?? [],
    withdrawals: withdrawals.data ?? [],
    admin_edits: (audit.data ?? []).map((row) => auditRow(row as Row, emails)),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in as the superadmin.' }, 401)
  if (!isAdmin(user)) return json({ error: 'Forbidden' }, 403)
  const { data: allowed, error: roleError } = await admin.rpc('is_superadmin_user', { p_user_id: user.id })
  if (roleError) {
    await logEdgeError(admin, 'admin', 'admin-panel.role_check', roleError, { code: roleError.code })
    return json({ error: 'Could not verify access.' }, 500)
  }
  if (allowed !== true) return json({ error: 'Forbidden' }, 403)

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }

  const action = String(body.action ?? '')
  try {
    if (action === 'overview') return json(await overview(admin))
    if (action === 'user_detail') {
      const id = typeof body.user_id === 'string' ? body.user_id : ''
      if (!UUID.test(id)) return json({ error: 'Invalid user.' }, 400)
      return json(await userDetail(admin, id))
    }
    return json({ error: 'Unknown action.' }, 400)
  } catch (err) {
    await logEdgeError(admin, 'admin', `admin-panel.${action || 'unknown'}`, err, { userId: user.id })
    return json({ error: 'Could not load the superadmin panel.' }, 500)
  }
})
