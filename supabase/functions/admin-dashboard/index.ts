import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { User } from 'npm:@supabase/supabase-js@2'
import { collectedTotals, mergeJoinedUsers, splitMpesaDeposits } from '../_shared/admin-dashboard.ts'
import { isAdmin } from '../_shared/admin-staff.ts'
import { loadAdminDashboardSources } from '../_shared/direct-admin.ts'
import { adminClient, corsHeaders, json, userFromRequest } from '../_shared/server.ts'

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
    const { authUsers, profiles, deposits } = sources
    const users = mergeJoinedUsers(authUsers, profiles)
    const emails = new Map(users.map((row) => [row.id, row.email]))
    const { collected, other } = splitMpesaDeposits(deposits)
    const totals = collectedTotals(collected)
    const withEmail = <T extends { user_id: string }>(row: T) => ({
      ...row,
      user_email: emails.get(row.user_id) ?? null,
    })
    console.log('admin-dashboard overview', user.id, users.length, totals.count)
    return json({
      users,
      collected: collected.map(withEmail),
      other: other.map(withEmail),
      totals: {
        collected_usd: totals.usd,
        collected_kes: totals.kes,
        collected_count: totals.count,
        user_count: users.length,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error'
    const safe = message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[db]').slice(0, 180)
    console.error('admin-dashboard.overview', safe)
    return json({ error: 'Could not load the dashboard.' }, 500)
  }
})
