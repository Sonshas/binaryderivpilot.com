import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2'
import { isAdmin } from '../_shared/admin-staff.ts'
import {
  hostFeesFromMaps,
  paymentRowsFromHost,
  tradingRowsFromHost,
  validateHostFeePatch,
  type DepositFeeSettings,
  type HostFeeSettings,
  type SettingsMap,
  type TradingFeeSettings,
  type WithdrawalFeeSettings,
} from '../_shared/payment-settings.ts'
import { adminClient, corsHeaders, json, logEdgeError, userFromRequest } from '../_shared/server.ts'
import { parseMegapayConfig } from '../_shared/megapay.ts'
import { parseWithdrawalConfig } from '../_shared/withdrawals.ts'

function appRole(user: User): string {
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>
  return typeof meta.role === 'string' ? meta.role.trim() : ''
}

async function loadTextMap(admin: SupabaseClient, table: 'payment_settings' | 'trading_settings'): Promise<SettingsMap> {
  const { data, error } = await admin.from(table).select('key, value')
  if (error) {
    await logEdgeError(admin, 'admin', `admin-fees.load.${table}`, error, { code: error.code })
    throw new Error(`${table} query failed`)
  }
  const map: SettingsMap = {}
  for (const row of data ?? []) {
    const key = String((row as { key?: unknown }).key ?? '')
    if (!key) continue
    map[key] = String((row as { value?: unknown }).value ?? '')
  }
  return map
}

async function loadHost(admin: SupabaseClient): Promise<HostFeeSettings> {
  const env = Deno.env.toObject()
  const [payment, trading] = await Promise.all([loadTextMap(admin, 'payment_settings'), loadTextMap(admin, 'trading_settings')])
  return hostFeesFromMaps(payment, trading, {
    deposit: parseMegapayConfig(env),
    withdrawal: parseWithdrawalConfig(env),
  })
}

async function saveHost(
  admin: SupabaseClient,
  deposit: DepositFeeSettings,
  withdrawal: WithdrawalFeeSettings,
  trading: TradingFeeSettings,
): Promise<void> {
  const now = new Date().toISOString()
  const paymentRows = paymentRowsFromHost(deposit, withdrawal).map((row) => ({ ...row, updated_at: now }))
  const tradingRows = tradingRowsFromHost(trading).map((row) => ({ ...row, updated_at: now }))
  const { error: payErr } = await admin.from('payment_settings').upsert(paymentRows, { onConflict: 'key' })
  if (payErr) {
    await logEdgeError(admin, 'admin', 'admin-fees.payment_upsert', payErr, { code: payErr.code })
    throw new Error('Could not save deposit/withdrawal fees.')
  }
  const { error: tradeErr } = await admin.from('trading_settings').upsert(tradingRows, { onConflict: 'key' })
  if (tradeErr) {
    await logEdgeError(admin, 'admin', 'admin-fees.trading_upsert', tradeErr, { code: tradeErr.code })
    throw new Error('Could not save trading fees.')
  }
}

function asPartialRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function numOrUndefined(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : Number.NaN
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in as an admin.' }, 401)
  if (!isAdmin(user)) {
    console.log('admin-fees forbidden', user.id, appRole(user) || 'trader')
    return json({ error: 'Forbidden' }, 403)
  }

  try {
    if (req.method === 'GET') {
      const host = await loadHost(admin)
      return json({ ok: true, host })
    }

    let body: Record<string, unknown> = {}
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid request.' }, 400)
    }

    const currentHost = await loadHost(admin)
    const depositIn = asPartialRecord(body.deposit)
    const withdrawalIn = asPartialRecord(body.withdrawal)
    const tradingIn = asPartialRecord(body.trading)

    const nextDeposit: DepositFeeSettings = {
      ...currentHost.deposit,
      ...(depositIn
        ? {
            kesPerUsd: numOrUndefined(depositIn.kesPerUsd) ?? currentHost.deposit.kesPerUsd,
            minKes: numOrUndefined(depositIn.minKes) ?? currentHost.deposit.minKes,
            maxKes: numOrUndefined(depositIn.maxKes) ?? currentHost.deposit.maxKes,
            quickAmounts:
              typeof depositIn.quickAmounts === 'string' ? depositIn.quickAmounts : currentHost.deposit.quickAmounts,
          }
        : {}),
    }
    const nextWithdrawal: WithdrawalFeeSettings = {
      ...currentHost.withdrawal,
      ...(withdrawalIn
        ? {
            kesPerUsd: numOrUndefined(withdrawalIn.kesPerUsd) ?? currentHost.withdrawal.kesPerUsd,
            minKes: numOrUndefined(withdrawalIn.minKes) ?? currentHost.withdrawal.minKes,
            maxKes: numOrUndefined(withdrawalIn.maxKes) ?? currentHost.withdrawal.maxKes,
            feeKes: numOrUndefined(withdrawalIn.feeKes) ?? currentHost.withdrawal.feeKes,
          }
        : {}),
    }
    const nextTrading: TradingFeeSettings = {
      ...currentHost.trading,
      ...(tradingIn
        ? {
            stakeMinUsd: numOrUndefined(tradingIn.stakeMinUsd) ?? currentHost.trading.stakeMinUsd,
            stakeMaxUsd: numOrUndefined(tradingIn.stakeMaxUsd) ?? currentHost.trading.stakeMaxUsd,
            maxOpenTrades: numOrUndefined(tradingIn.maxOpenTrades) ?? currentHost.trading.maxOpenTrades,
            dailyProfitLimitUsd:
              numOrUndefined(tradingIn.dailyProfitLimitUsd) ?? currentHost.trading.dailyProfitLimitUsd,
            payoutPercent: numOrUndefined(tradingIn.payoutPercent) ?? currentHost.trading.payoutPercent,
          }
        : {}),
    }

    const hostErrors = validateHostFeePatch({
      deposit: nextDeposit,
      withdrawal: nextWithdrawal,
      trading: nextTrading,
    })
    if (hostErrors.length) return json({ error: hostErrors[0]!.message, fields: hostErrors }, 400)

    await saveHost(admin, nextDeposit, nextWithdrawal, nextTrading)
    const host = await loadHost(admin)
    console.log('admin-fees saved', user.id)
    return json({
      ok: true,
      message: 'Fees saved.',
      host,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (!/query failed|Could not save/.test(message)) {
      await logEdgeError(admin, 'admin', 'admin-fees', err)
    }
    return json({ error: 'Could not load fees. See System health for details.' }, 500)
  }
})
