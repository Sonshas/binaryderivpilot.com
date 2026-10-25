import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  DEPOSIT_EXPIRY_MS,
  MEGAPAY_PROVIDER,
  classifyMegapayStatus,
  parseMegapayConfig,
  type MegapayConfig,
} from './payments/megapay.ts'
import {
  MEGAPAY_RR_CURSOR,
  accountEnabledInMap,
  nextMegapayAccountId,
  normalizeMegapayAccountId,
  parseMegapayAccounts,
  type MegapayAccount,
  type MegapayAccountId,
} from './payments/megapay-accounts.ts'
import { siteApiUrl } from './branding.ts'
import { depositFeesFromMap, mergeMegapayConfig, parseQuickAmounts, type SettingsMap } from './payments/payment-settings.ts'

const MEGAPAY_BASE = 'https://megapay.co.ke/backend/v1'
export const DEFAULT_VAST_WEBHOOK_URL = siteApiUrl('/api/megapay/webhook')
export const UNAVAILABLE_MESSAGE = 'Deposits temporarily unavailable'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export interface ServerConfig extends MegapayConfig {
  apiKey: string | null
  email: string | null
  accounts: MegapayAccount[]
  vastWebhookUrl: string
}

export type MegapayCreds = Pick<MegapayAccount, 'apiKey' | 'email' | 'id'>

export function serverConfig(): ServerConfig {
  const env = Deno.env.toObject()
  const accounts = parseMegapayAccounts(env)
  const primary = accounts[0] ?? null
  return {
    ...parseMegapayConfig(env),
    apiKey: primary?.apiKey ?? (env.MEGAPAY_API_KEY?.trim() || null),
    email: primary?.email ?? (env.MEGAPAY_EMAIL?.trim() || null),
    accounts,
    vastWebhookUrl: env.VAST_WEBHOOK_URL?.trim() || DEFAULT_VAST_WEBHOOK_URL,
  }
}

export async function loadPaymentSettingsMap(admin: SupabaseClient): Promise<SettingsMap> {
  const { data, error } = await admin.from('payment_settings').select('key, value')
  if (error) {
    await logEdgeError(admin, 'payments', 'payment_settings.load', error, { code: error.code })
    return {}
  }
  const map: SettingsMap = {}
  for (const row of data ?? []) {
    const key = String((row as { key?: unknown }).key ?? '')
    if (!key) continue
    map[key] = String((row as { value?: unknown }).value ?? '')
  }
  return map
}

export async function resolveServerConfig(admin: SupabaseClient): Promise<ServerConfig & { quickAmounts: number[] }> {
  const base = serverConfig()
  const map = await loadPaymentSettingsMap(admin)
  const money = mergeMegapayConfig(base, map)
  const deposit = depositFeesFromMap(map, base)
  return { ...base, ...money, quickAmounts: parseQuickAmounts(deposit.quickAmounts) }
}

export function credentialsConfigured(cfg: ServerConfig): boolean {
  return cfg.accounts.length > 0 || Boolean(cfg.apiKey && cfg.email)
}

export function resolveMegapayCreds(
  cfg: ServerConfig,
  accountId: unknown,
): MegapayCreds | null {
  const id = normalizeMegapayAccountId(accountId)
  const match = cfg.accounts.find((a) => a.id === id)
  if (match) return { id: match.id, apiKey: match.apiKey, email: match.email }
  const fallback = cfg.accounts[0]
  if (fallback) return { id: fallback.id, apiKey: fallback.apiKey, email: fallback.email }
  if (cfg.apiKey && cfg.email) return { id: 'winsoft', apiKey: cfg.apiKey, email: cfg.email }
  return null
}

/** Enabled MegaPay accounts only; alternates Winsoft↔Vast when both are on. */
export async function claimMegapayAccount(
  admin: SupabaseClient,
  cfg: ServerConfig,
  map?: SettingsMap,
): Promise<MegapayCreds | null> {
  const settings = map ?? (await loadPaymentSettingsMap(admin))
  const enabled = cfg.accounts.filter((a) => accountEnabledInMap(settings, a.id))
  const nextId = nextMegapayAccountId(
    enabled.map((a) => a.id),
    settings[MEGAPAY_RR_CURSOR],
  )
  if (!nextId) return null
  const picked = enabled.find((a) => a.id === nextId) ?? null
  if (!picked) return null
  const now = new Date().toISOString()
  await admin.from('payment_settings').upsert(
    {
      key: MEGAPAY_RR_CURSOR,
      value: picked.id,
      description: 'Last MegaPay account used for round-robin STK (winsoft or vast).',
      updated_at: now,
    },
    { onConflict: 'key' },
  )
  return { id: picked.id, apiKey: picked.apiKey, email: picked.email }
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface SystemIssueInput {
  source: 'web' | 'edge' | 'probe'
  area: string
  operation: string
  code?: string | null
  message: string
  route?: string | null
  userId?: string | null
}

export async function recordSystemIssue(admin: SupabaseClient, issue: SystemIssueInput): Promise<void> {
  try {
    const { error } = await admin.rpc('report_system_issue', {
      p_source: issue.source,
      p_area: issue.area,
      p_operation: issue.operation,
      p_code: issue.code ?? null,
      p_message: issue.message,
      p_route: issue.route ?? null,
      p_user_id: issue.userId ?? null,
    })
    if (error) console.error('report_system_issue', error.code ?? 'error')
  } catch (err) {
    console.error('report_system_issue', err instanceof Error ? err.message : 'error')
  }
}

/** Feed reconnect / timeout blips — log to console only, do not open staff issues. */
export function isTransientEdgeNoise(message: string): boolean {
  return /deriv websocket (closed|error)|deriv websocket not (connected|open)|deriv connection timeout|deriv unavailable|live price is unavailable|request idle timeout|failed to fetch|signal timed out|timeouterror|aborted|aborterror/i.test(
    message,
  )
}

/** console.error + system_issues — use for edge failures that must not stay silent. */
export async function logEdgeError(
  admin: SupabaseClient | null,
  area: string,
  operation: string,
  err: unknown,
  extras?: { code?: string | null; userId?: string | null },
): Promise<void> {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err)
  const code =
    extras?.code ??
    (err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code ?? '') || null : null)
  console.error(operation, message)
  if (!admin || isTransientEdgeNoise(message)) return
  await recordSystemIssue(admin, {
    source: 'edge',
    area,
    operation,
    code,
    message: message.slice(0, 500),
    userId: extras?.userId ?? null,
  })
}

export async function userFromRequest(admin: SupabaseClient, req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export async function realPaymentsEnabled(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin.from('feature_flags').select('value').eq('key', 'REAL_PAYMENTS_ENABLED').maybeSingle()
  return data?.value === true
}

async function megapayPost(path: string, body: Record<string, unknown>, timeoutMs: number) {
  const res = await fetch(`${MEGAPAY_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { raw: text.slice(0, 500) }
  }
  return { httpStatus: res.status, body: parsed }
}

export async function initiateStk(
  creds: MegapayCreds | ServerConfig,
  amountKes: number,
  msisdn: string,
  reference: string,
) {
  const apiKey = 'apiKey' in creds ? creds.apiKey : null
  const email = 'email' in creds ? creds.email : null
  return megapayPost(
    'initiatestk',
    { api_key: apiKey, email, amount: amountKes, msisdn, reference },
    20_000,
  )
}

export async function transactionStatus(
  creds: MegapayCreds | ServerConfig,
  transactionRequestId: string,
) {
  const apiKey = 'apiKey' in creds ? creds.apiKey : null
  const email = 'email' in creds ? creds.email : null
  return megapayPost(
    'transactionstatus',
    { api_key: apiKey, email, transaction_request_id: transactionRequestId },
    10_000,
  )
}

export interface DepositRow {
  id: string
  user_id: string
  amount: number | string
  currency: string
  status: string
  provider: string | null
  provider_reference: string | null
  details: Record<string, unknown>
  created_at: string
}

export const DEPOSIT_COLUMNS = 'id, user_id, amount, currency, status, provider, provider_reference, details, created_at'

export async function loadDeposit(admin: SupabaseClient, id: string): Promise<DepositRow | null> {
  const { data } = await admin.from('deposits').select(DEPOSIT_COLUMNS).eq('id', id).maybeSingle()
  return (data as DepositRow | null) ?? null
}

async function failDeposit(admin: SupabaseClient, id: string, status: 'FAILED' | 'CANCELLED', kind: string, reason: string, raw: unknown) {
  const { error } = await admin.rpc('fail_megapay_deposit', {
    p_deposit_id: id,
    p_status: status,
    p_kind: kind,
    p_reason: reason,
    p_raw: raw ?? {},
  })
  if (error) await logEdgeError(admin, 'deposits', 'fail_megapay_deposit', error, { code: error.code })
}

function isCreditable(d: DepositRow): boolean {
  return d.status === 'PENDING' || d.status === 'PROCESSING' || (d.status === 'FAILED' && d.details?.failure_kind === 'expired')
}

export async function reconcileDeposit(admin: SupabaseClient, cfg: ServerConfig, deposit: DepositRow): Promise<DepositRow> {
  if (deposit.provider !== MEGAPAY_PROVIDER || !isCreditable(deposit)) return deposit
  const pending = deposit.status === 'PENDING' || deposit.status === 'PROCESSING'
  const expired = pending && Date.now() - Date.parse(deposit.created_at) > DEPOSIT_EXPIRY_MS

  const creds = resolveMegapayCreds(cfg, deposit.details?.megapay_account)
  if (!deposit.provider_reference || !creds) {
    if (expired) await failDeposit(admin, deposit.id, 'FAILED', 'expired', 'No confirmation from M-Pesa in time', {})
    return (await loadDeposit(admin, deposit.id)) ?? deposit
  }

  let status
  try {
    status = await transactionStatus(creds, deposit.provider_reference)
  } catch (err) {
    await logEdgeError(admin, 'deposits', 'megapay.transactionstatus', err)
    if (expired) await failDeposit(admin, deposit.id, 'FAILED', 'expired', 'No confirmation from M-Pesa in time', {})
    return (await loadDeposit(admin, deposit.id)) ?? deposit
  }

  const result = classifyMegapayStatus(status.body)
  const expectedKes = Number(deposit.details?.amount_kes)

  if (result.outcome === 'completed') {
    if (result.amountKes !== expectedKes) {
      await logEdgeError(
        admin,
        'deposits',
        'megapay.amount_mismatch',
        `expected ${expectedKes} got ${result.amountKes}`,
      )
      if (pending) await failDeposit(admin, deposit.id, 'FAILED', 'amount_mismatch', 'Paid amount did not match the request', status.body)
    } else {
      // Gate STKs (scanner / verification / tax) must not credit the trading wallet.
      const details = deposit.details ?? {}
      const serviceCharge =
        details.type === 'service_charge' ||
        details.kind === 'verification' ||
        details.kind === 'scanner' ||
        details.kind === 'tax'
      const rpc = serviceCharge ? 'complete_service_charge_deposit' : 'credit_megapay_deposit'
      const { error } = await admin.rpc(rpc, {
        p_deposit_id: deposit.id,
        p_receipt: result.receipt ?? '',
        p_amount_kes: result.amountKes,
        p_raw: status.body,
      })
      if (error) {
        await logEdgeError(admin, 'deposits', serviceCharge ? 'megapay.complete_service_charge' : 'credit_megapay_deposit', error, {
          code: error.code,
        })
      } else {
        const { notifyAdminsPaymentReceived, lookupUserEmail } = await import('./admin-payment-email.ts')
        const userEmail = await lookupUserEmail(admin, deposit.user_id)
        const kindRaw = String(details.kind ?? '')
        const kind =
          serviceCharge && (kindRaw === 'verification' || kindRaw === 'scanner' || kindRaw === 'tax')
            ? kindRaw
            : serviceCharge
              ? 'service_charge'
              : 'deposit'
        await notifyAdminsPaymentReceived(admin, {
          amountKes: result.amountKes,
          kind,
          userEmail,
          receipt: result.receipt ?? null,
          depositId: deposit.id,
        })
      }
    }
  } else if ((result.outcome === 'failed' || result.outcome === 'cancelled') && pending) {
    await failDeposit(
      admin,
      deposit.id,
      result.outcome === 'cancelled' ? 'CANCELLED' : 'FAILED',
      'megapay_' + result.outcome,
      result.description,
      status.body,
    )
  } else if (expired) {
    await failDeposit(admin, deposit.id, 'FAILED', 'expired', 'No confirmation from M-Pesa in time', status.body)
  }

  return (await loadDeposit(admin, deposit.id)) ?? deposit
}

export function publicDeposit(d: DepositRow) {
  return {
    deposit_id: d.id,
    reference: (d.details?.reference as string | undefined) ?? null,
    status: d.status,
    amount_usd: Number(d.amount),
    amount_kes: Number(d.details?.amount_kes),
    rate: Number(d.details?.rate),
    receipt: (d.details?.mpesa_receipt as string | undefined) ?? null,
    failure_reason: d.status === 'COMPLETED' ? null : ((d.details?.failure_reason as string | undefined) ?? null),
    created_at: d.created_at,
  }
}
