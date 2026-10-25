import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { readAllPages, readByIds } from '../_shared/admin-batch.ts'
import { isCreditedDeposit, toDashboardDeposit, type DepositSource } from '../_shared/admin-dashboard.ts'
import { appRole, isAdmin, writeAudit } from '../_shared/admin-staff.ts'
import { adminClient, corsHeaders, json, logEdgeError, userFromRequest } from '../_shared/server.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Row = Record<string, unknown>

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function money(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

async function loadUserRows(admin: SupabaseClient): Promise<Row[]> {
  return await readAllPages<Row>((from, to) =>
    admin
      .from('users')
      .select(
        'id, email, name, role, account_status, live_trading_enabled, deposits_enabled, withdrawals_enabled, win_rate_percent, kyc_status, created_at, suspended_at, withdraw_verification_enabled, withdraw_scanner_enabled, withdraw_tax_enabled, is_vip, withdraw_gates_cleared',
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  )
}

async function walletsByUser(admin: SupabaseClient, userIds: string[]) {
  const map = new Map<string, { available: number; locked: number; balance: number; currency: string }>()
  const data = await readByIds<Row>(userIds, (part, from, to) =>
    admin
      .from('wallets')
      .select('id, user_id, available_balance, locked_balance, balance, currency')
      .eq('account_mode', 'real')
      .eq('is_simulated', false)
      .in('user_id', part)
      .order('id', { ascending: true })
      .range(from, to),
  )
  for (const row of data) {
    map.set(String(row.user_id), {
      available: money(row.available_balance),
      locked: money(row.locked_balance),
      balance: money(row.balance),
      currency: String(row.currency ?? 'USD'),
    })
  }
  return map
}

async function profilesByUser(admin: SupabaseClient, userIds: string[]) {
  const map = new Map<string, { phone: string; country: string; display_name: string | null }>()
  const data = await readByIds<Row>(userIds, (part, from, to) =>
    admin
      .from('profiles')
      .select('user_id, phone, country, display_name')
      .in('user_id', part)
      .order('user_id', { ascending: true })
      .range(from, to),
  )
  for (const row of data) {
    map.set(String(row.user_id), {
      phone: String(row.phone ?? ''),
      country: String(row.country ?? ''),
      display_name: typeof row.display_name === 'string' ? row.display_name : null,
    })
  }
  return map
}

async function depositStats(admin: SupabaseClient, userIds: string[]) {
  const collected = new Map<string, { usd: number; kes: number; count: number }>()
  const openFail = new Map<string, number>()
  const data = await readByIds<Row>(userIds, (part, from, to) =>
    admin
      .from('deposits')
      .select(
        'id, user_id, amount, currency, status, provider, method, mpesa_receipt, callback_amount_kes, details, created_at, updated_at, is_simulated, account_mode',
      )
      .eq('account_mode', 'real')
      .eq('is_simulated', false)
      .eq('method', 'mpesa')
      .in('user_id', part)
      .order('id', { ascending: true })
      .range(from, to),
  )
  for (const row of data) {
    const uid = String(row.user_id)
    const source: DepositSource = {
      id: String(row.id),
      user_id: uid,
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
    if (isCreditedDeposit(source)) {
      const view = toDashboardDeposit(source)
      const cur = collected.get(uid) ?? { usd: 0, kes: 0, count: 0 }
      cur.usd += view.amount_usd ?? 0
      cur.kes += view.amount_kes ?? 0
      cur.count += 1
      collected.set(uid, cur)
    } else if (source.status === 'PENDING' || source.status === 'FAILED' || source.status === 'PROCESSING') {
      openFail.set(uid, (openFail.get(uid) ?? 0) + 1)
    }
  }
  return { collected, openFail }
}

async function openWithdrawals(admin: SupabaseClient, userIds: string[]) {
  const map = new Map<string, number>()
  const data = await readByIds<Row>(userIds, (part, from, to) =>
    admin
      .from('withdrawals')
      .select('id, user_id')
      .eq('account_mode', 'real')
      .eq('is_simulated', false)
      .in('status', ['PENDING', 'PROCESSING'])
      .in('user_id', part)
      .order('id', { ascending: true })
      .range(from, to),
  )
  for (const row of data) {
    const uid = String(row.user_id)
    map.set(uid, (map.get(uid) ?? 0) + 1)
  }
  return map
}

async function tradeCounts(admin: SupabaseClient, userIds: string[]) {
  const map = new Map<string, number>()
  const data = await readByIds<Row>(userIds, (part, from, to) =>
    admin
      .from('trades')
      .select('id, user_id')
      .eq('account_mode', 'real')
      .eq('is_simulated', false)
      .in('user_id', part)
      .order('id', { ascending: true })
      .range(from, to),
  )
  for (const row of data) {
    const uid = String(row.user_id)
    map.set(uid, (map.get(uid) ?? 0) + 1)
  }
  return map
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const actor = await userFromRequest(admin, req)
  if (!actor) return json({ error: 'Sign in as an admin.' }, 401)
  if (!isAdmin(actor)) {
    console.log('admin-users forbidden', actor.id, appRole(actor))
    return json({ error: 'Forbidden' }, 403)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  const action = String(body.action ?? '')

  try {
    if (action === 'list') {
      const users = await loadUserRows(admin)
      const ids = users.map((u) => String(u.id))
      const [wallets, profiles, deps, opens, trades] = await Promise.all([
        walletsByUser(admin, ids),
        profilesByUser(admin, ids),
        depositStats(admin, ids),
        openWithdrawals(admin, ids),
        tradeCounts(admin, ids),
      ])
      const rows = users.map((u) => {
        const id = String(u.id)
        const wallet = wallets.get(id)
        const profile = profiles.get(id)
        const col = deps.collected.get(id)
        return {
          id,
          email: u.email ?? null,
          name: u.name ?? profile?.display_name ?? null,
          phone: profile?.phone ?? '',
          country: profile?.country ?? '',
          role: u.role ?? 'trader',
          account_status: u.account_status ?? 'active',
          live_trading_enabled: u.live_trading_enabled !== false,
          deposits_enabled: u.deposits_enabled !== false,
          withdrawals_enabled: u.withdrawals_enabled !== false,
          win_rate_percent: u.win_rate_percent == null ? null : Number(u.win_rate_percent),
          withdraw_verification_enabled:
            u.withdraw_verification_enabled == null ? null : u.withdraw_verification_enabled === true,
          withdraw_scanner_enabled:
            u.withdraw_scanner_enabled == null ? null : u.withdraw_scanner_enabled === true,
          withdraw_tax_enabled:
            u.withdraw_tax_enabled == null ? null : u.withdraw_tax_enabled === true,
          is_vip: u.is_vip === true,
          withdraw_gates_cleared: u.withdraw_gates_cleared === true,
          kyc_status: u.kyc_status ?? 'not_started',
          created_at: u.created_at,
          available_usd: wallet?.available ?? 0,
          locked_usd: wallet?.locked ?? 0,
          balance_usd: wallet?.balance ?? 0,
          collected_usd: col ? Math.round(col.usd * 100) / 100 : 0,
          collected_kes: col ? Math.round(col.kes * 100) / 100 : 0,
          collected_count: col?.count ?? 0,
          open_withdrawals: opens.get(id) ?? 0,
          pending_deposits: deps.openFail.get(id) ?? 0,
          trade_count: trades.get(id) ?? 0,
        }
      })
      return json({ users: rows })
    }

    if (action === 'get') {
      const userId = String(body.user_id ?? '')
      if (!UUID_RE.test(userId)) return json({ error: 'Invalid user.' }, 400)
      const { data: user, error: userError } = await admin
        .from('users')
        .select(
          'id, email, name, role, account_status, live_trading_enabled, deposits_enabled, withdrawals_enabled, win_rate_percent, kyc_status, created_at, suspended_at, withdraw_verification_enabled, withdraw_scanner_enabled, withdraw_tax_enabled, is_vip, withdraw_gates_cleared',
        )
        .eq('id', userId)
        .maybeSingle()
      if (userError || !user) return json({ error: 'User not found.' }, 404)
      const [
        profileRes,
        walletRes,
        depositsRes,
        withdrawalsRes,
        txRes,
        tradesRes,
        ticketsRes,
        kycRes,
        botsRes,
        auditRes,
        notesRes,
      ] = await Promise.all([
        admin.from('profiles').select('phone, country, display_name, staff_note').eq('user_id', userId).maybeSingle(),
        admin
          .from('wallets')
          .select('id, available_balance, locked_balance, balance, currency')
          .eq('user_id', userId)
          .eq('account_mode', 'real')
          .eq('is_simulated', false)
          .maybeSingle(),
        admin
          .from('deposits')
          .select(
            'id, amount, currency, status, provider, method, mpesa_receipt, callback_amount_kes, details, created_at, updated_at, checkout_request_id',
          )
          .eq('user_id', userId)
          .eq('account_mode', 'real')
          .order('created_at', { ascending: false })
          .limit(100),
        admin
          .from('withdrawals')
          .select(
            'id, amount, amount_kes, status, msisdn, reference, mpesa_receipt, failure_reason, admin_note, created_at, completed_at',
          )
          .eq('user_id', userId)
          .eq('account_mode', 'real')
          .order('created_at', { ascending: false })
          .limit(100),
        admin
          .from('transactions')
          .select('id, type, amount, currency, status, note, reference, created_at')
          .eq('user_id', userId)
          .eq('account_mode', 'real')
          .order('created_at', { ascending: false })
          .limit(150),
        admin
          .from('trades')
          .select('id, symbol, contract_type, contract_option, stake, status, profit_loss, payout, created_at, resolved_at')
          .eq('user_id', userId)
          .eq('account_mode', 'real')
          .order('created_at', { ascending: false })
          .limit(100),
        admin
          .from('support_tickets')
          .select('id, subject, status, created_at, updated_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50),
        admin
          .from('kyc_reviews')
          .select('id, status, document_paths, notes, created_at, reviewed_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20),
        admin
          .from('bot_runs')
          .select('id, bot_id, status, stake, trades_placed, realized_pnl, started_at, stopped_at, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50),
        admin
          .from('audit_log')
          .select('id, actor_email, action, before_state, after_state, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(100),
        admin
          .from('notifications')
          .select('id, title, body, kind, read, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50),
      ])

      return json({
        user: {
          ...user,
          phone: profileRes.data?.phone ?? '',
          country: profileRes.data?.country ?? '',
          display_name: profileRes.data?.display_name ?? user.name,
          staff_note: profileRes.data?.staff_note ?? '',
          available_usd: money(walletRes.data?.available_balance),
          locked_usd: money(walletRes.data?.locked_balance),
          balance_usd: money(walletRes.data?.balance),
          wallet_id: walletRes.data?.id ?? null,
        },
        deposits: depositsRes.data ?? [],
        withdrawals: withdrawalsRes.data ?? [],
        transactions: txRes.data ?? [],
        trades: tradesRes.data ?? [],
        tickets: ticketsRes.data ?? [],
        kyc_reviews: kycRes.data ?? [],
        bot_runs: botsRes.data ?? [],
        audit: auditRes.data ?? [],
        notifications: notesRes.data ?? [],
      })
    }

    if (action === 'update') {
      const userId = String(body.user_id ?? '')
      if (!UUID_RE.test(userId)) return json({ error: 'Invalid user.' }, 400)
      const { data: before } = await admin.from('users').select('*').eq('id', userId).maybeSingle()
      if (!before) return json({ error: 'User not found.' }, 404)

      const patch: Record<string, unknown> = {}
      if (typeof body.role === 'string' && body.role.trim()) patch.role = body.role.trim()
      if (typeof body.account_status === 'string' && body.account_status.trim()) {
        patch.account_status = body.account_status.trim()
        patch.suspended_at = body.account_status.trim() === 'suspended' ? new Date().toISOString() : null
      }
      if (typeof body.deposits_enabled === 'boolean') patch.deposits_enabled = body.deposits_enabled
      if (typeof body.withdrawals_enabled === 'boolean') patch.withdrawals_enabled = body.withdrawals_enabled
      if (typeof body.live_trading_enabled === 'boolean') patch.live_trading_enabled = body.live_trading_enabled
      if (typeof body.is_vip === 'boolean') patch.is_vip = body.is_vip
      if (typeof body.withdraw_gates_cleared === 'boolean') {
        patch.withdraw_gates_cleared = body.withdraw_gates_cleared
      }
      for (const col of [
        'withdraw_verification_enabled',
        'withdraw_scanner_enabled',
        'withdraw_tax_enabled',
      ] as const) {
        if (body[col] === null) patch[col] = null
        else if (typeof body[col] === 'boolean') patch[col] = body[col]
      }
      if (body.win_rate_percent === null) patch.win_rate_percent = null
      else if (body.win_rate_percent != null && body.win_rate_percent !== '') {
        const rate = Number(body.win_rate_percent)
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) return json({ error: 'Win rate must be 0–100 or empty.' }, 400)
        patch.win_rate_percent = rate
      }
      if (typeof body.kyc_status === 'string' && body.kyc_status.trim()) patch.kyc_status = body.kyc_status.trim()
      if (typeof body.name === 'string') patch.name = body.name.trim() || null

      if (Object.keys(patch).length) {
        const { error } = await admin.from('users').update(patch).eq('id', userId)
        if (error) return json({ error: error.message }, 500)
      }

      const profilePatch: Record<string, unknown> = {}
      if (typeof body.phone === 'string') profilePatch.phone = body.phone.trim()
      if (typeof body.country === 'string') profilePatch.country = body.country.trim()
      if (typeof body.display_name === 'string') profilePatch.display_name = body.display_name.trim() || null
      if (typeof body.staff_note === 'string') profilePatch.staff_note = body.staff_note
      if (Object.keys(profilePatch).length) {
        const { error } = await admin.from('profiles').upsert({ user_id: userId, ...profilePatch }, { onConflict: 'user_id' })
        if (error) return json({ error: error.message }, 500)
      }

      if (typeof body.app_role === 'string' && body.app_role.trim()) {
        const { error } = await admin.auth.admin.updateUserById(userId, {
          app_metadata: { role: body.app_role.trim() },
        })
        if (error) return json({ error: error.message }, 500)
        if (!patch.role) {
          await admin.from('users').update({ role: body.app_role.trim() }).eq('id', userId)
        }
      }

      await writeAudit(admin, {
        actorId: actor.id,
        actorEmail: actor.email ?? null,
        action: 'user_update',
        userId,
        targetType: 'user',
        targetId: userId,
        before: before as Record<string, unknown>,
        after: { ...patch, ...profilePatch, app_role: body.app_role ?? undefined },
      })
      return json({ ok: true })
    }

    if (action === 'adjust_balance') {
      const userId = String(body.user_id ?? '')
      const amount = Number(body.amount)
      const note = typeof body.note === 'string' ? body.note : ''
      if (!UUID_RE.test(userId)) return json({ error: 'Invalid user.' }, 400)
      const { data, error } = await admin.rpc('admin_adjust_wallet', {
        p_user_id: userId,
        p_amount: amount,
        p_note: note,
        p_actor_id: actor.id,
        p_actor_email: actor.email ?? '',
      })
      if (error) {
        const msg = error.message || ''
        if (msg.includes('insufficient_funds')) return json({ error: 'Not enough available balance.' }, 409)
        if (msg.includes('wallet_not_found')) return json({ error: 'Wallet not ready.' }, 409)
        if (msg.includes('invalid_amount') || msg.includes('amount_too_large')) return json({ error: 'Invalid amount.' }, 400)
        return json({ error: 'Adjustment failed.' }, 500)
      }
      return json({ ok: true, wallet: data })
    }

    if (action === 'notify') {
      const userId = String(body.user_id ?? '')
      const title = String(body.title ?? '').trim()
      const message = String(body.body ?? body.message ?? '').trim()
      if (!UUID_RE.test(userId) || !title || !message) return json({ error: 'Title and message are required.' }, 400)
      const { data: account } = await admin
        .from('accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('account_mode', 'real')
        .maybeSingle()
      const { error } = await admin.from('notifications').insert({
        user_id: userId,
        account_id: account?.id ?? null,
        account_mode: 'real',
        kind: 'admin',
        title: title.slice(0, 120),
        body: message.slice(0, 2000),
        read: false,
        is_simulated: false,
      })
      if (error) return json({ error: error.message }, 500)
      await writeAudit(admin, {
        actorId: actor.id,
        actorEmail: actor.email ?? null,
        action: 'notify',
        userId,
        targetType: 'notification',
        after: { title, body: message },
      })
      return json({ ok: true })
    }

    if (action === 'kyc_review') {
      const userId = String(body.user_id ?? '')
      const reviewId = String(body.review_id ?? '')
      const status = String(body.status ?? '').trim().toLowerCase()
      if (!UUID_RE.test(userId) || !UUID_RE.test(reviewId) || !['approved', 'rejected'].includes(status)) {
        return json({ error: 'Invalid KYC review.' }, 400)
      }
      const notes = typeof body.notes === 'string' ? body.notes.trim() : null
      const { error } = await admin
        .from('kyc_reviews')
        .update({ status, notes, reviewed_at: new Date().toISOString(), reviewer_id: actor.id })
        .eq('id', reviewId)
        .eq('user_id', userId)
      if (error) return json({ error: error.message }, 500)
      await admin.from('users').update({ kyc_status: status }).eq('id', userId)
      await writeAudit(admin, {
        actorId: actor.id,
        actorEmail: actor.email ?? null,
        action: 'kyc_review',
        userId,
        targetType: 'kyc_review',
        targetId: reviewId,
        after: { status, notes },
      })
      return json({ ok: true })
    }

    // --- Ops lists (shared admin console) ---
    if (action === 'audit_list') {
      const limit = Math.min(500, Math.max(1, Number(body.limit) || 200))
      let q = admin
        .from('audit_log')
        .select('id, actor_email, action, user_id, target_type, target_id, before_state, after_state, created_at')
        .order('created_at', { ascending: false })
        .limit(limit)
      const userId = typeof body.user_id === 'string' ? body.user_id : ''
      if (UUID_RE.test(userId)) q = q.eq('user_id', userId)
      const { data, error } = await q
      if (error) return json({ error: error.message }, 500)
      return json({ rows: data ?? [] })
    }

    if (action === 'markets_list') {
      const { data, error } = await admin.from('markets').select('*').order('symbol')
      if (error) return json({ error: error.message }, 500)
      return json({ markets: data ?? [] })
    }

    if (action === 'markets_update') {
      const symbol = String(body.symbol ?? '').trim()
      if (!symbol) return json({ error: 'Symbol required.' }, 400)
      const patch: Record<string, unknown> = {}
      if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
      if (typeof body.display_name === 'string') patch.display_name = body.display_name.trim()
      if (!Object.keys(patch).length) return json({ error: 'Nothing to update.' }, 400)
      const { error } = await admin.from('markets').update(patch).eq('symbol', symbol)
      if (error) return json({ error: error.message }, 500)
      await writeAudit(admin, {
        actorId: actor.id,
        actorEmail: actor.email ?? null,
        action: 'markets_update',
        targetType: 'market',
        targetId: null,
        after: { symbol, ...patch },
      })
      return json({ ok: true })
    }

    if (action === 'service_fees') {
      const { data, error } = await admin
        .from('deposits')
        .select(
          'id, user_id, amount, currency, status, method, mpesa_receipt, callback_amount_kes, details, created_at, updated_at, is_simulated, account_mode, provider',
        )
        .eq('account_mode', 'real')
        .eq('is_simulated', false)
        .eq('method', 'mpesa')
        .eq('status', 'COMPLETED')
        .filter('details->>type', 'eq', 'service_charge')
        .order('created_at', { ascending: false })
        .limit(1000)
      if (error) return json({ error: error.message }, 500)
      const rows = (data ?? []).map((raw) => {
        const row = raw as Record<string, unknown>
        const source: DepositSource = {
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
          is_simulated: false,
          account_mode: 'real',
        }
        return toDashboardDeposit(source)
      })
      return json({ rows })
    }

    if (action === 'stk_queue') {
      const { data, error } = await admin
        .from('deposits')
        .select(
          'id, user_id, amount, currency, status, provider, method, mpesa_receipt, callback_amount_kes, details, created_at, updated_at, checkout_request_id, result_desc',
        )
        .eq('account_mode', 'real')
        .eq('is_simulated', false)
        .eq('method', 'mpesa')
        .in('status', ['PENDING', 'PROCESSING', 'FAILED', 'CANCELLED'])
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) return json({ error: error.message }, 500)
      return json({ rows: data ?? [] })
    }

    if (action === 'megapay_events') {
      const { data, error } = await admin
        .from('megapay_webhook_events')
        .select(
          'id, received_at, reference, transaction_id, routed_to, forward_status, forward_error, attempts, processed, process_result',
        )
        .order('received_at', { ascending: false })
        .limit(200)
      if (error) return json({ error: error.message }, 500)
      return json({ rows: data ?? [] })
    }

    if (action === 'bots_list') {
      const [{ data: bots, error: botsError }, { data: runs, error: runsError }] = await Promise.all([
        admin.from('bots').select('*').order('created_at', { ascending: false }).limit(200),
        admin
          .from('bot_runs')
          .select('id, user_id, bot_id, status, stake, trades_placed, realized_pnl, started_at, stopped_at, created_at')
          .order('created_at', { ascending: false })
          .limit(200),
      ])
      if (botsError) return json({ error: botsError.message }, 500)
      if (runsError) return json({ error: runsError.message }, 500)
      return json({ bots: bots ?? [], runs: runs ?? [] })
    }

    if (action === 'bot_stop') {
      const runId = String(body.run_id ?? '')
      if (!UUID_RE.test(runId)) return json({ error: 'Invalid run.' }, 400)
      const { error } = await admin
        .from('bot_runs')
        .update({ status: 'stopped', stopped_at: new Date().toISOString() })
        .eq('id', runId)
        .in('status', ['active', 'running', 'open'])
      if (error) return json({ error: error.message }, 500)
      await writeAudit(admin, {
        actorId: actor.id,
        actorEmail: actor.email ?? null,
        action: 'bot_stop',
        targetType: 'bot_run',
        targetId: runId,
      })
      return json({ ok: true })
    }

    if (action === 'deposits_list') {
      const { data, error } = await admin
        .from('deposits')
        .select(
          'id, user_id, amount, currency, status, provider, method, mpesa_receipt, callback_amount_kes, details, created_at, updated_at',
        )
        .eq('account_mode', 'real')
        .eq('is_simulated', false)
        .eq('status', 'COMPLETED')
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) return json({ error: error.message }, 500)
      const users = await loadUserRows(admin)
      const emailById = new Map(users.map((u) => [String(u.id), (u.email as string | null) ?? null]))
      const rows = (data ?? []).map((raw) => {
        const row = raw as Record<string, unknown>
        const details = asRecord(row.details)
        const source: DepositSource = {
          id: String(row.id),
          user_id: String(row.user_id),
          amount: (row.amount as number | string | null) ?? null,
          currency: (row.currency as string | null) ?? null,
          status: (row.status as string | null) ?? null,
          provider: (row.provider as string | null) ?? null,
          method: (row.method as string | null) ?? null,
          mpesa_receipt: (row.mpesa_receipt as string | null) ?? null,
          callback_amount_kes: (row.callback_amount_kes as number | string | null) ?? null,
          details,
          created_at: String(row.created_at ?? ''),
          updated_at: String(row.updated_at ?? ''),
          is_simulated: false,
          account_mode: 'real',
        }
        const mapped = toDashboardDeposit(source)
        return { ...mapped, user_email: emailById.get(String(row.user_id)) ?? null }
      })
      return json({ rows })
    }

    if (action === 'trades_list') {
      const { data, error } = await admin
        .from('trades')
        .select(
          'id, user_id, symbol, contract_type, contract_option, stake, status, profit_loss, payout, account_mode, created_at, resolved_at',
        )
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) return json({ error: error.message }, 500)
      const users = await loadUserRows(admin)
      const emailById = new Map(users.map((u) => [String(u.id), (u.email as string | null) ?? null]))
      const rows = (data ?? []).map((row) => ({
        ...row,
        user_email: emailById.get(String(row.user_id)) ?? null,
      }))
      return json({ rows })
    }

    if (action === 'ledger_list') {
      const { data, error } = await admin
        .from('transactions')
        .select('id, user_id, type, amount, currency, status, note, reference, account_mode, created_at')
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) return json({ error: error.message }, 500)
      const users = await loadUserRows(admin)
      const emailById = new Map(users.map((u) => [String(u.id), (u.email as string | null) ?? null]))
      const rows = (data ?? []).map((row) => ({
        ...row,
        user_email: emailById.get(String(row.user_id)) ?? null,
      }))
      return json({ rows })
    }

    if (action === 'support_list') {
      const { data, error } = await admin
        .from('support_tickets')
        .select('id, user_id, subject, message, status, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) return json({ error: error.message }, 500)
      const ticketIds = (data ?? []).map((row) => String(row.id))
      const { data: messages } = ticketIds.length
        ? await admin
            .from('support_messages')
            .select('id, ticket_id, message, sender_role, created_at')
            .in('ticket_id', ticketIds)
            .order('created_at', { ascending: true })
        : { data: [] as Record<string, unknown>[] }
      const users = await loadUserRows(admin)
      const emailById = new Map(users.map((u) => [String(u.id), (u.email as string | null) ?? null]))
      const byTicket = new Map<string, Record<string, unknown>[]>()
      for (const msg of messages ?? []) {
        const tid = String(msg.ticket_id)
        const list = byTicket.get(tid) ?? []
        list.push(msg as Record<string, unknown>)
        byTicket.set(tid, list)
      }
      const rows = (data ?? []).map((row) => ({
        ...row,
        user_email: emailById.get(String(row.user_id)) ?? null,
        messages: byTicket.get(String(row.id)) ?? [],
      }))
      return json({ rows })
    }

    if (action === 'support_reply') {
      const ticketId = String(body.ticket_id ?? '')
      const message = String(body.message ?? '').trim()
      if (!UUID_RE.test(ticketId) || message.length < 2) return json({ error: 'Reply required.' }, 400)
      const { data: ticket, error: ticketError } = await admin
        .from('support_tickets')
        .select('id, user_id, status')
        .eq('id', ticketId)
        .maybeSingle()
      if (ticketError || !ticket) return json({ error: 'Ticket not found.' }, 404)
      const { error: msgError } = await admin.from('support_messages').insert({
        ticket_id: ticketId,
        sender_user_id: actor.id,
        sender_role: 'admin',
        message: message.slice(0, 4000),
      })
      if (msgError) return json({ error: msgError.message }, 500)
      await admin.from('support_tickets').update({ updated_at: new Date().toISOString() }).eq('id', ticketId)
      const { data: account } = await admin
        .from('accounts')
        .select('id')
        .eq('user_id', ticket.user_id)
        .eq('account_mode', 'real')
        .maybeSingle()
      await admin.from('notifications').insert({
        user_id: ticket.user_id,
        account_id: account?.id ?? null,
        account_mode: 'real',
        kind: 'support',
        title: 'New support reply',
        body: message.slice(0, 500),
        read: false,
        is_simulated: false,
      })
      await writeAudit(admin, {
        actorId: actor.id,
        actorEmail: actor.email ?? null,
        action: 'support_reply',
        userId: String(ticket.user_id),
        targetType: 'support_ticket',
        targetId: ticketId,
      })
      return json({ ok: true })
    }

    if (action === 'support_close') {
      const ticketId = String(body.ticket_id ?? '')
      if (!UUID_RE.test(ticketId)) return json({ error: 'Invalid ticket.' }, 400)
      const { data: ticket, error: ticketError } = await admin
        .from('support_tickets')
        .select('id, user_id')
        .eq('id', ticketId)
        .maybeSingle()
      if (ticketError || !ticket) return json({ error: 'Ticket not found.' }, 404)
      const { error } = await admin.from('support_tickets').update({ status: 'closed' }).eq('id', ticketId)
      if (error) return json({ error: error.message }, 500)
      await writeAudit(admin, {
        actorId: actor.id,
        actorEmail: actor.email ?? null,
        action: 'support_close',
        userId: String(ticket.user_id),
        targetType: 'support_ticket',
        targetId: ticketId,
      })
      return json({ ok: true })
    }

    if (action === 'notifications_list') {
      const { data, error } = await admin
        .from('notifications')
        .select('id, user_id, title, body, kind, read, created_at')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) return json({ error: error.message }, 500)
      const users = await loadUserRows(admin)
      const emailById = new Map(users.map((u) => [String(u.id), (u.email as string | null) ?? null]))
      const rows = (data ?? []).map((row) => ({
        ...row,
        user_email: emailById.get(String(row.user_id)) ?? null,
      }))
      return json({ rows })
    }

    if (action === 'notify_broadcast') {
      const title = String(body.title ?? '').trim()
      const message = String(body.body ?? body.message ?? '').trim()
      if (title.length < 2 || message.length < 2) return json({ error: 'Title and message are required.' }, 400)
      const users = await loadUserRows(admin)
      const ids = users.map((u) => String(u.id))
      if (!ids.length) return json({ ok: true, count: 0 })
      const accounts = await readByIds<Row>(ids, (part, from, to) =>
        admin
          .from('accounts')
          .select('id, user_id')
          .eq('account_mode', 'real')
          .in('user_id', part)
          .order('id', { ascending: true })
          .range(from, to),
      )
      const accountByUser = new Map(accounts.map((row) => [String(row.user_id), String(row.id)]))
      const payload = ids.map((userId) => ({
        user_id: userId,
        account_id: accountByUser.get(userId) ?? null,
        account_mode: 'real',
        kind: 'admin',
        title: title.slice(0, 120),
        body: message.slice(0, 2000),
        read: false,
        is_simulated: false,
      }))
      const { error } = await admin.from('notifications').insert(payload)
      if (error) return json({ error: error.message }, 500)
      await writeAudit(admin, {
        actorId: actor.id,
        actorEmail: actor.email ?? null,
        action: 'notify_broadcast',
        targetType: 'notification',
        after: { title, body: message, count: payload.length },
      })
      return json({ ok: true, count: payload.length })
    }

    if (action === 'kyc_list') {
      const { data, error } = await admin
        .from('kyc_reviews')
        .select('id, user_id, status, document_paths, notes, created_at, reviewed_at')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) return json({ error: error.message }, 500)
      const users = await loadUserRows(admin)
      const emailById = new Map(users.map((u) => [String(u.id), (u.email as string | null) ?? null]))
      const rows = (data ?? []).map((row) => ({
        ...row,
        user_email: emailById.get(String(row.user_id)) ?? null,
      }))
      return json({ rows })
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch (err) {
    await logEdgeError(admin, 'admin', `admin-users.${action || 'unknown'}`, err)
    return json({ error: 'Could not complete that admin action.' }, 500)
  }
})
