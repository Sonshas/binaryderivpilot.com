import { raceWithTimeout } from '@/lib/abort-timeout'
import { dataApiFetch, peekStoredAccessToken, supabaseApiAuth } from '@/lib/supabase'
import type { Result } from '@/services/megapay'

const FUNCTION = 'admin-dashboard'
/** Direct SQL may fail over to PostgREST; keep under the Edge wall clock. */
/** Lean REST overview often needs 15–25s after PostgREST stalls. */
const LOAD_MS = 35_000

export interface DashboardUserRow {
  id: string
  email: string | null
  signedUpAt: string
  role: string
}

export interface DashboardDepositRow {
  id: string
  userId: string
  userEmail: string | null
  amountUsd: number | null
  amountKes: number | null
  status: string
  provider: string | null
  payment: string
  receipt: string | null
  createdAt: string
  creditedAt: string | null
}

export interface AdminDashboard {
  users: DashboardUserRow[]
  collected: DashboardDepositRow[]
  other: DashboardDepositRow[]
  totals: {
    collectedUsd: number | null
    collectedKes: number | null
    collectedCount: number
    userCount: number
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function money(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function mapUser(raw: Record<string, unknown>): DashboardUserRow | null {
  const id = text(raw.id)
  if (!id) return null
  return {
    id,
    email: text(raw.email),
    signedUpAt: text(raw.signed_up_at) ?? '',
    role: text(raw.role) ?? 'trader',
  }
}

function mapDeposit(raw: Record<string, unknown>): DashboardDepositRow | null {
  const id = text(raw.id)
  if (!id) return null
  return {
    id,
    userId: text(raw.user_id) ?? '',
    userEmail: text(raw.user_email),
    amountUsd: money(raw.amount_usd),
    amountKes: money(raw.amount_kes),
    status: text(raw.status) ?? '',
    provider: text(raw.provider),
    payment: text(raw.payment) ?? 'Deposit',
    receipt: text(raw.receipt),
    createdAt: text(raw.created_at) ?? '',
    creditedAt: text(raw.credited_at),
  }
}

function mapList(value: unknown, map: (raw: Record<string, unknown>) => DashboardDepositRow | null): DashboardDepositRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const mapped = map(row as Record<string, unknown>)
    return mapped ? [mapped] : []
  })
}

function mapDashboard(data: Record<string, unknown>): AdminDashboard {
  const totals = data.totals && typeof data.totals === 'object' ? (data.totals as Record<string, unknown>) : {}
  const users = Array.isArray(data.users)
    ? data.users.flatMap((row) => {
        if (!row || typeof row !== 'object') return []
        const mapped = mapUser(row as Record<string, unknown>)
        return mapped ? [mapped] : []
      })
    : []
  return {
    users,
    collected: mapList(data.collected, mapDeposit),
    other: mapList(data.other, mapDeposit),
    totals: {
      collectedUsd: money(totals.collected_usd),
      collectedKes: money(totals.collected_kes),
      collectedCount: Number(totals.collected_count ?? 0) || 0,
      userCount: Number(totals.user_count ?? users.length) || users.length,
    },
  }
}

/** Bearer from local storage, so the dashboard does not wait on the Auth lock. */
async function loadOverviewDirect(): Promise<Result<AdminDashboard> | null> {
  const api = supabaseApiAuth()
  const token = peekStoredAccessToken()
  if (!api || !token) return null
  let response: Response
  try {
    response = await raceWithTimeout(
      dataApiFetch(`${api.url}/functions/v1/${FUNCTION}`, {
        method: 'POST',
        headers: {
          apikey: api.key,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'overview' }),
      }),
      LOAD_MS,
      'Could not load the dashboard.',
    )
  } catch {
    return { ok: false, error: 'Could not load the dashboard.' }
  }
  let body: Record<string, unknown> = {}
  try {
    body = (await response.json()) as Record<string, unknown>
  } catch {
    return { ok: false, error: 'Could not load the dashboard.' }
  }
  if (!response.ok) {
    return { ok: false, error: text(body.error) ?? text(body.message) ?? 'Could not load the dashboard.' }
  }
  return { ok: true, data: mapDashboard(body) }
}

export const adminDashboardService = {
  async load(): Promise<Result<AdminDashboard>> {
    // Bearer from local storage. functions.invoke waits on the Auth lock and
    // getSession, which is the path that bounced /admin back to /login.
    const direct = await loadOverviewDirect()
    if (direct) return direct
    return { ok: false, error: 'Sign in as an admin.' }
  },
}
