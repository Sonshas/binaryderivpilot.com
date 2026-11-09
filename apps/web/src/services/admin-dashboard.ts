import { abortSignalAfter, raceWithTimeout } from '@/lib/abort-timeout'
import { getSupabase } from '@/lib/supabase'
import type { Result } from '@/services/megapay'
import { reportBackendIssue } from '@/services/system-issues'

const FUNCTION = 'admin-dashboard'
/** Direct SQL + pooler retry can take a few seconds; keep under the Edge wall clock. */
const LOAD_MS = 16_000

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

function contextStatus(error: unknown): number | null {
  const context = (error as { context?: Response } | null)?.context
  return context && typeof context.status === 'number' ? context.status : null
}

async function functionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response } | null)?.context
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.clone().json()) as { error?: string; message?: string }
      if (body.error || body.message) return String(body.error ?? body.message)
    } catch {
    }
  }
  return 'Could not load the dashboard.'
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

export const adminDashboardService = {
  async load(): Promise<Result<AdminDashboard>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: 'Dashboard is temporarily unavailable.' }
    let data: Record<string, unknown> | null = null
    let error: unknown = null
    try {
      const result = await raceWithTimeout(
        client.functions.invoke<Record<string, unknown>>(FUNCTION, {
          method: 'POST',
          body: { action: 'overview' },
          signal: abortSignalAfter(LOAD_MS),
        }),
        LOAD_MS,
        'Could not load the dashboard.',
      )
      data = result.data
      error = result.error
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (!/timed out|timeout|could not load the dashboard/i.test(message)) {
        reportBackendIssue('admin', 'admin-dashboard.overview', err)
      }
      return { ok: false, error: 'Could not load the dashboard.' }
    }
    if (error || !data) {
      const message = await functionError(error)
      const status = contextStatus(error)
      if (status === 401 || status === 403) return { ok: false, error: message }
      reportBackendIssue('admin', 'admin-dashboard.overview', error ?? new Error('Empty dashboard response'), status)
      return { ok: false, error: message }
    }
    const totals = data.totals && typeof data.totals === 'object' ? (data.totals as Record<string, unknown>) : {}
    const users = Array.isArray(data.users)
      ? data.users.flatMap((row) => {
          if (!row || typeof row !== 'object') return []
          const mapped = mapUser(row as Record<string, unknown>)
          return mapped ? [mapped] : []
        })
      : []
    return {
      ok: true,
      data: {
        users,
        collected: mapList(data.collected, mapDeposit),
        other: mapList(data.other, mapDeposit),
        totals: {
          collectedUsd: money(totals.collected_usd),
          collectedKes: money(totals.collected_kes),
          collectedCount: Number(totals.collected_count ?? 0) || 0,
          userCount: Number(totals.user_count ?? users.length) || users.length,
        },
      },
    }
  },
}
