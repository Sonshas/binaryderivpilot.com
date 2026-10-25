import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { isAdmin } from '../_shared/admin-staff.ts'
import { parseDepositProvider, type DepositProvider } from '../_shared/daraja.ts'
import {
  enabledSettingKey,
  parseMegapayAccounts,
  publicMegapayAccounts,
  type MegapayAccountId,
  type MegapayAccountPublic,
} from '../_shared/payments/megapay-accounts.ts'
import { adminClient, corsHeaders, json, logEdgeError, loadPaymentSettingsMap, userFromRequest } from '../_shared/server.ts'

const WITHDRAW_STEPS = ['verification', 'scanner', 'tax'] as const
type ExternalKind = (typeof WITHDRAW_STEPS)[number]

export interface WithdrawControls {
  scannerUsd: number
  verificationUsd: number
  taxUsd: number
  defaultKesPerUsd: number
  scannerEnabled: boolean
  verificationEnabled: boolean
  taxEnabled: boolean
  withdrawOrder: ExternalKind[]
}

const DEFAULTS: WithdrawControls = {
  scannerUsd: 50,
  verificationUsd: 0,
  taxUsd: 0,
  defaultKesPerUsd: 130,
  scannerEnabled: true,
  verificationEnabled: true,
  taxEnabled: true,
  withdrawOrder: [...WITHDRAW_STEPS],
}

function clampRate(value: unknown, fallback: number): number {
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100_000) return fallback
  return Math.round(rate * 10_000) / 10_000
}

function clampUsd(value: unknown, fallback: number, allowZero: boolean): number {
  const amount = Math.round(Number(value) * 100) / 100
  if (!Number.isFinite(amount) || amount > 1_900) return fallback
  if (amount < 0 || (amount === 0 && !allowZero)) return fallback
  return amount
}

function boolSetting(map: Record<string, string>, key: string, fallback: boolean): boolean {
  const raw = map[key]
  if (raw == null || raw === '') return fallback
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false
  return fallback
}

function normalizeOrder(value: unknown): ExternalKind[] {
  const seen = new Set<ExternalKind>()
  const order: ExternalKind[] = []
  const parts = Array.isArray(value)
    ? value.map(String)
    : String(value ?? '').split(/[,\s]+/).filter(Boolean)
  for (const item of parts) {
    if (item === 'verification' || item === 'scanner' || item === 'tax') {
      if (seen.has(item)) continue
      seen.add(item)
      order.push(item)
    }
  }
  for (const item of WITHDRAW_STEPS) {
    if (!seen.has(item)) order.push(item)
  }
  return order
}

function withdrawFromMap(map: Record<string, string>): WithdrawControls {
  return {
    scannerUsd: clampUsd(map.WITHDRAW_SCANNER_FEE_USD, DEFAULTS.scannerUsd, false),
    verificationUsd: clampUsd(map.WITHDRAW_VERIFICATION_FEE_USD, DEFAULTS.verificationUsd, true),
    taxUsd: clampUsd(map.WITHDRAW_TAX_FEE_USD, DEFAULTS.taxUsd, true),
    // Gate STK rate only — do not fall back to DEPOSIT_KES_PER_USD (Admin → Fees).
    defaultKesPerUsd: clampRate(map.WITHDRAW_PROMPT_KES_PER_USD, DEFAULTS.defaultKesPerUsd),
    scannerEnabled: boolSetting(map, 'WITHDRAW_SCANNER_ENABLED', true),
    verificationEnabled: boolSetting(map, 'WITHDRAW_VERIFICATION_ENABLED', true),
    taxEnabled: boolSetting(map, 'WITHDRAW_TAX_ENABLED', true),
    withdrawOrder: normalizeOrder(map.WITHDRAW_STEP_ORDER),
  }
}

function payModeFromMap(map: Record<string, string>, envFallback: string | undefined): DepositProvider {
  return parseDepositProvider(map.DEPOSIT_PROVIDER || envFallback)
}

function kesForUsd(usd: number, rate: number): number {
  return Math.max(0, Math.round(usd * rate))
}

async function saveWithdraw(admin: SupabaseClient, next: WithdrawControls): Promise<void> {
  const now = new Date().toISOString()
  const rows = [
    { key: 'WITHDRAW_PROMPT_KES_PER_USD', value: String(next.defaultKesPerUsd), description: 'KES charged on M-Pesa per $1 for withdraw gate prompts.', updated_at: now },
    { key: 'WITHDRAW_SCANNER_FEE_USD', value: String(next.scannerUsd), description: 'AI scanner withdraw-gate fee in USD.', updated_at: now },
    { key: 'WITHDRAW_VERIFICATION_FEE_USD', value: String(next.verificationUsd), description: 'Account verification withdraw-gate fee in USD.', updated_at: now },
    { key: 'WITHDRAW_TAX_FEE_USD', value: String(next.taxUsd), description: 'Tax compliance withdraw-gate fee in USD.', updated_at: now },
    { key: 'WITHDRAW_SCANNER_ENABLED', value: String(next.scannerEnabled), description: 'Global AI scanner withdraw step.', updated_at: now },
    { key: 'WITHDRAW_VERIFICATION_ENABLED', value: String(next.verificationEnabled), description: 'Global verification withdraw step.', updated_at: now },
    { key: 'WITHDRAW_TAX_ENABLED', value: String(next.taxEnabled), description: 'Global tax withdraw step.', updated_at: now },
    { key: 'WITHDRAW_STEP_ORDER', value: next.withdrawOrder.join(','), description: 'Comma-separated withdraw gate order.', updated_at: now },
    { key: 'SCANNER_FEE_KES', value: String(kesForUsd(next.scannerUsd, next.defaultKesPerUsd)), description: 'AI scanner STK amount in KES.', updated_at: now },
    { key: 'VERIFICATION_FEE_KES', value: String(kesForUsd(next.verificationUsd, next.defaultKesPerUsd)), description: 'Verification STK amount in KES.', updated_at: now },
    { key: 'TAX_FEE_KES', value: String(kesForUsd(next.taxUsd, next.defaultKesPerUsd)), description: 'Tax STK amount in KES.', updated_at: now },
  ]
  const { error } = await admin.from('payment_settings').upsert(rows, { onConflict: 'key' })
  if (error) {
    await logEdgeError(admin, 'admin', 'platform-settings.withdraw_upsert', error, { code: error.code })
    throw new Error('Could not save withdrawal controls.')
  }
}

async function savePayMode(admin: SupabaseClient, mode: DepositProvider): Promise<void> {
  const { error } = await admin.from('payment_settings').upsert(
    {
      key: 'DEPOSIT_PROVIDER',
      value: mode,
      description: 'Active Real deposit rail: daraja or megapay.',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  )
  if (error) {
    await logEdgeError(admin, 'admin', 'platform-settings.paymode_upsert', error, { code: error.code })
    throw new Error('Could not save pay mode.')
  }
}

async function saveMegapayAccounts(
  admin: SupabaseClient,
  patch: Partial<Record<MegapayAccountId, boolean>>,
): Promise<MegapayAccountPublic[]> {
  const env = Deno.env.toObject()
  const accounts = parseMegapayAccounts(env)
  const map = await loadPaymentSettingsMap(admin)
  const now = new Date().toISOString()
  const rows: { key: string; value: string; description: string; updated_at: string }[] = []
  for (const id of ['winsoft', 'vast'] as MegapayAccountId[]) {
    if (typeof patch[id] !== 'boolean') continue
    rows.push({
      key: enabledSettingKey(id),
      value: String(patch[id]),
      description: `MegaPay ${id} merchant enabled for STK round-robin.`,
      updated_at: now,
    })
    map[enabledSettingKey(id)] = String(patch[id])
  }
  if (rows.length === 0) return publicMegapayAccounts(accounts, map)
  const { error } = await admin.from('payment_settings').upsert(rows, { onConflict: 'key' })
  if (error) {
    await logEdgeError(admin, 'admin', 'platform-settings.megapay_accounts', error, { code: error.code })
    throw new Error('Could not save MegaPay accounts.')
  }
  return publicMegapayAccounts(accounts, map)
}

async function memberGateState(admin: SupabaseClient, userId: string) {
  const [{ data: deposits }, { data: profile }] = await Promise.all([
    admin
      .from('deposits')
      .select('details, status')
      .eq('user_id', userId)
      .eq('status', 'COMPLETED')
      .limit(200),
    admin.from('profiles').select('withdraw_place').eq('user_id', userId).maybeSingle(),
  ])
  const paid: Partial<Record<ExternalKind, string>> = {}
  for (const row of deposits ?? []) {
    const details = (row as { details?: Record<string, unknown> | null }).details
    if (!details || typeof details !== 'object') continue
    const kind = String(details.kind ?? '')
    if (kind === 'verification' || kind === 'scanner' || kind === 'tax') {
      paid[kind] = new Date().toISOString()
    }
  }
  const placeRaw = (profile as { withdraw_place?: string | null } | null)?.withdraw_place
  const place =
    placeRaw === 'form' || placeRaw === 'verification' || placeRaw === 'scanner' || placeRaw === 'tax'
      ? placeRaw
      : null
  return { paid, place }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in required.' }, 401)

  try {
    const map = await loadPaymentSettingsMap(admin)
    const env = Deno.env.toObject()

    if (req.method === 'GET') {
      const withdraw = withdrawFromMap(map)
      const payMode = payModeFromMap(map, env.DEPOSIT_PROVIDER)
      const gates = await memberGateState(admin, user.id)
      const megapayAccounts = publicMegapayAccounts(parseMegapayAccounts(env), map)
      return json({ ok: true, withdraw, payMode, gates, megapayAccounts })
    }

    let body: Record<string, unknown> = {}
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid request.' }, 400)
    }

    const action = String(body.action ?? '')

    if (action === 'set_place') {
      const place = body.place == null || body.place === '' ? null : String(body.place).trim().toLowerCase()
      if (place != null && place !== 'form' && place !== 'verification' && place !== 'scanner' && place !== 'tax') {
        return json({ error: 'Invalid place.' }, 400)
      }
      const { error } = await admin.from('profiles').upsert(
        { user_id: user.id, withdraw_place: place },
        { onConflict: 'user_id' },
      )
      if (error) {
        await logEdgeError(admin, 'withdraw', 'platform-settings.set_place', error, { code: error.code })
        return json({ error: 'Could not save withdraw place.' }, 500)
      }
      return json({ ok: true, place })
    }

    if (!isAdmin(user)) return json({ error: 'Forbidden' }, 403)

    if (action === 'save_withdraw') {
      const current = withdrawFromMap(map)
      const next: WithdrawControls = {
        scannerUsd: clampUsd(body.scannerUsd ?? current.scannerUsd, DEFAULTS.scannerUsd, false),
        verificationUsd: clampUsd(body.verificationUsd ?? current.verificationUsd, DEFAULTS.verificationUsd, true),
        taxUsd: clampUsd(body.taxUsd ?? current.taxUsd, DEFAULTS.taxUsd, true),
        defaultKesPerUsd: clampRate(body.defaultKesPerUsd ?? current.defaultKesPerUsd, DEFAULTS.defaultKesPerUsd),
        scannerEnabled: typeof body.scannerEnabled === 'boolean' ? body.scannerEnabled : current.scannerEnabled,
        verificationEnabled:
          typeof body.verificationEnabled === 'boolean' ? body.verificationEnabled : current.verificationEnabled,
        taxEnabled: typeof body.taxEnabled === 'boolean' ? body.taxEnabled : current.taxEnabled,
        withdrawOrder: normalizeOrder(body.withdrawOrder ?? current.withdrawOrder),
      }
      await saveWithdraw(admin, next)
      return json({ ok: true, withdraw: next, message: 'Withdrawal controls saved for every account.' })
    }

    if (action === 'save_pay_mode') {
      const mode = parseDepositProvider(String(body.payMode ?? body.mode ?? ''))
      await savePayMode(admin, mode)
      return json({ ok: true, payMode: mode, message: 'Pay mode saved.' })
    }

    if (action === 'save_megapay_accounts') {
      const patch: Partial<Record<MegapayAccountId, boolean>> = {}
      if (typeof body.winsoft === 'boolean') patch.winsoft = body.winsoft
      if (typeof body.vast === 'boolean') patch.vast = body.vast
      const previewMap = { ...map }
      for (const id of ['winsoft', 'vast'] as MegapayAccountId[]) {
        if (typeof patch[id] === 'boolean') previewMap[enabledSettingKey(id)] = String(patch[id])
      }
      const preview = publicMegapayAccounts(parseMegapayAccounts(env), previewMap)
      const enabled = preview.filter((a) => a.enabled && a.configured)
      if (enabled.length === 0) {
        return json(
          {
            error: 'At least one configured MegaPay account must stay enabled.',
            megapayAccounts: publicMegapayAccounts(parseMegapayAccounts(env), map),
          },
          400,
        )
      }
      const megapayAccounts = await saveMegapayAccounts(admin, patch)
      return json({
        ok: true,
        megapayAccounts,
        message:
          enabled.length === 2
            ? 'Winsoft and Vast alternate on each STK.'
            : `${enabled[0]!.label} is the only active MegaPay account.`,
      })
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (!/Could not save/.test(message)) {
      await logEdgeError(admin, 'admin', 'platform-settings', err)
    }
    return json({ error: message || 'Could not load platform settings.' }, 500)
  }
})
