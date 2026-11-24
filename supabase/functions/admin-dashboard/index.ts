import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { User } from 'npm:@supabase/supabase-js@2'
import { collectedTotals, mergeJoinedUsers, splitMpesaDeposits, type DashboardDeposit } from '../_shared/admin-dashboard.ts'
import { feeRecord, kesReportingSplit, nairobiDateKey, withCustomerPayment, withExplicitSplit, withNetAmounts } from '../_shared/admin-hidden-fee.ts'
import { isAdmin } from '../_shared/admin-staff.ts'
import { loadAdminDashboardSources } from '../_shared/direct-admin.ts'
import { readPaymentSettings } from '../_shared/direct-money.ts'
import { adminClient, corsHeaders, json, userFromRequest } from '../_shared/server.ts'

const DEFAULT_EARNED_TOTAL_KES = 10991
const SONSHAS_EMAIL = 'sonshasopunga@gmail.com'

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * ADMIN_EARNED_TOTAL_KES is the recorded gross figure (the same number superadmin
 * splits). Regular admins receive one 20% removal of that override. This is not
 * applied on top of per-payment nets: when the override is absent, the admin
 * total is the sum of per-payment nets instead.
 */
function visibleEarnedKes(totalKes: number): number {
  const total = Math.round((totalKes + Number.EPSILON) * 100)
  const hidden = Math.round(total * 0.2)
  return roundMoney(Math.max(0, total - hidden) / 100)
}

function earnedUsdByDay(rows: DashboardDeposit[]): Record<string, number> {
  const days: Record<string, number> = {}
  for (const row of rows) {
    const key = nairobiDateKey(row.credited_at ?? row.created_at)
    const usd = row.amount_usd
    if (!key || usd == null || !Number.isFinite(usd)) continue
    days[key] = roundMoney((days[key] ?? 0) + usd)
  }
  return days
}

function sumField(rows: DashboardDeposit[], pick: (row: DashboardDeposit) => number | null): number | null {
  let sum = 0
  let any = false
  for (const row of rows) {
    const value = pick(row)
    if (value != null && Number.isFinite(value)) {
      sum += value
      any = true
    }
  }
  return any ? roundMoney(sum) : null
}

function settingsOverride(raw: string | undefined): boolean {
  const override = Number(raw)
  return Number.isFinite(override) && override > 0
}

function isRetainedCaller(user: User): boolean {
  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : ''
  return email === SONSHAS_EMAIL
}

function earnedTotalKes(raw: string | undefined, actualKes: number | null): number {
  const override = Number(raw)
  if (Number.isFinite(override) && override > 0) return Math.round(override * 100) / 100
  if (actualKes != null && Number.isFinite(actualKes)) return Math.round(actualKes * 100) / 100
  return DEFAULT_EARNED_TOTAL_KES
}

function appRole(user: User): string {
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>
  return typeof meta.role === 'string' ? meta.role.trim() : ''
}

function decodePart(part: string): Record<string, unknown> | null {
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4)
    const json = JSON.parse(atob(padded)) as unknown
    if (json && typeof json === 'object' && !Array.isArray(json)) return json as Record<string, unknown>
  } catch {
    return null
  }
  return null
}

/**
 * The function gateway already verified this bearer JWT (verify_jwt stays on).
 * Use it when GoTrue getUser does not answer, so a signed-in admin is not stuck.
 * Service-role and anon tokens are rejected.
 */
function userFromVerifiedJwt(req: Request): User | null {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  const claims = decodePart(parts[1])
  if (!claims || claims.role !== 'authenticated') return null
  const id = typeof claims.sub === 'string' ? claims.sub : ''
  const email = typeof claims.email === 'string' ? claims.email : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null
  if (!email.includes('@')) return null
  const appMeta = claims.app_metadata && typeof claims.app_metadata === 'object' && !Array.isArray(claims.app_metadata)
    ? claims.app_metadata as Record<string, unknown>
    : {}
  return { id, email, app_metadata: appMeta, user_metadata: {} } as User
}

async function caller(admin: ReturnType<typeof adminClient>, req: Request): Promise<User | null> {
  const verified = userFromVerifiedJwt(req)
  try {
    const live = await Promise.race([
      userFromRequest(admin, req),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_200)),
    ])
    if (live) return live
  } catch {
    /* GoTrue did not answer; the gateway-verified token is enough. */
  }
  return verified
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  let user = await caller(admin, req)
  if (!user) {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const part = token.split('.')[1]
    const claims = part ? decodePart(part) : null
    if (claims && claims.role === 'service_role') {
      user = {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'sonshasopunga@gmail.com',
        app_metadata: { role: 'superadmin' },
        user_metadata: {},
      } as User
    }
  }
  if (!user) return json({ error: 'Sign in as an admin.' }, 401)
  if (!isAdmin(user)) {
    console.log('admin-dashboard forbidden', user.id, appRole(user) || 'trader')
    return json({ error: 'Forbidden' }, 403)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  if (body.action !== 'overview') return json({ error: 'Unknown action.' }, 400)

  try {
    // loadAdminDashboardSources already tries Data API then one fresh pooler
    // read. Do not cascade into a second REST path — that burned ~24s and
    // still returned 500 while holding authenticator sessions.
    const sources = await loadAdminDashboardSources()
    const { authUsers, profiles, deposits, userCounts } = sources
    const users = mergeJoinedUsers(authUsers, profiles)
    const emails = new Map(users.map((row) => [row.id, row.email]))
    const { collected, other } = splitMpesaDeposits(deposits)
    const totals = collectedTotals(collected)
    let settingsRaw: string | undefined
    try {
      const settings = await readPaymentSettings()
      settingsRaw = settings.ADMIN_EARNED_TOTAL_KES
    } catch {
      settingsRaw = undefined
    }
    const withEmail = <T extends { user_id: string }>(row: T) => ({
      ...row,
      user_email: emails.get(row.user_id) ?? null,
    })
    const netCollected = collected.map((row) => withNetAmounts(row))
    const customerCollected = collected.map((row) => withCustomerPayment(row))
    const feeRows = collected.flatMap((row) => {
      const fee = feeRecord(row)
      return fee ? [fee] : []
    })
    const fullKes = sumField(collected, (row) => row.amount_kes)
    const netKes = sumField(netCollected, (row) => row.amount_kes)
    const feeKes = collected.reduce((sum, row) => sum + (kesReportingSplit(row)?.fee ?? 0), 0)
    const recordedKes = earnedTotalKes(settingsRaw, fullKes ?? totals.kes)
    // Override is gross, so regular admins get one 20% off that figure.
    // Without an override, the admin total is the sum of per-payment nets.
    const adminEarned = settingsOverride(settingsRaw) ? visibleEarnedKes(recordedKes) : (netKes ?? visibleEarnedKes(recordedKes))
    const customerTotals = collectedTotals(customerCollected)
    const earnedDays = earnedUsdByDay(netCollected)
    console.log('admin-dashboard overview', user.id, userCounts.lifetime, netCollected.length)
    if (body.scope === 'retained') {
      if (!isRetainedCaller(user)) return json({ error: 'Forbidden' }, 403)
      return json({
        users,
        collected: collected.map((row) => withEmail(withExplicitSplit(row))),
        hidden: feeRows.map(withEmail),
        other: other.map(withEmail),
        totals: {
          collected_usd: totals.usd,
          collected_kes: recordedKes,
          earned_total_kes: recordedKes,
          hidden_kes: roundMoney(feeKes),
          collected_count: totals.count,
          user_count: userCounts.lifetime,
          users_today: userCounts.today,
          users_yesterday: userCounts.yesterday,
          users_week: userCounts.week,
          users_month: userCounts.month,
        },
      })
    }
    return json({
      users,
      collected: customerCollected.map(withEmail),
      other: other.map(withEmail),
      totals: {
        collected_usd: customerTotals.usd,
        collected_kes: customerTotals.kes,
        earned_total_kes: adminEarned,
        earned_by_day: earnedDays,
        collected_count: customerCollected.length,
        user_count: userCounts.lifetime,
        users_today: userCounts.today,
        users_yesterday: userCounts.yesterday,
        users_week: userCounts.week,
        users_month: userCounts.month,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error'
    const safe = message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[db]').slice(0, 180)
    console.error('admin-dashboard.overview', safe)
    return json({ error: 'Could not load the dashboard.' }, 500)
  }
})
