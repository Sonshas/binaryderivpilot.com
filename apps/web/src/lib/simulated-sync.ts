import type { RealtimeChannel } from '@supabase/supabase-js'
import { clampWinRatePercent } from '@/domain/outcome/win-rate'
import { adjustStoredDemoAvailable, peekDemoAvailable } from '@/lib/demo-store'
import { getSupabase } from '@/lib/supabase'

/**
 * Links the browser-side Demo wallet (lib/demo-store) to the superadmin panel:
 *  - reports the Demo balance to public.simulated_balances so the panel can show it;
 *  - adopts a balance the superadmin set (admin_version newer than the one this browser applied);
 *  - caches the server Demo win rate (per-user override, else global) used to settle Demo trades.
 * Virtual money only — nothing here touches the real wallet, trades or withdrawals.
 */

const VERSION_KEY = 'sbb.demo.adminVersion'
const POLL_MS = 120_000
const REPORT_DEBOUNCE_MS = 4_000

export interface ServerDemoRow {
  balance: number
  admin_version: number
  accepted: boolean
}

export type SyncStep = { kind: 'done' } | { kind: 'adopt'; target: number; version: number }

/** What to do with the server's answer to a report. */
export function nextSyncStep(row: ServerDemoRow | null, seenVersion: number): SyncStep {
  if (!row || row.accepted) return { kind: 'done' }
  if (row.admin_version <= seenVersion) return { kind: 'done' }
  const target = Number(row.balance)
  if (!Number.isFinite(target) || target < 0) return { kind: 'done' }
  return { kind: 'adopt', target: Math.round(target * 100) / 100, version: row.admin_version }
}

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

function versionKey(email: string): string {
  return `${VERSION_KEY}:${email.trim().toLowerCase()}`
}

export function readSeenVersion(email: string): number {
  if (!canUseStorage()) return 0
  const n = Number(localStorage.getItem(versionKey(email)))
  return Number.isInteger(n) && n > 0 ? n : 0
}

export function writeSeenVersion(email: string, version: number): void {
  if (canUseStorage()) localStorage.setItem(versionKey(email), String(version))
}

/** Sets the Demo available balance to `target` (ledger + notification via the demo store). */
export function adoptDemoBalance(email: string, target: number): void {
  const delta = Math.round((target - peekDemoAvailable(email)) * 100) / 100
  if (delta !== 0) adjustStoredDemoAvailable(email, delta)
}

// ---------------------------------------------------------------------------
// Demo win rate cache
// ---------------------------------------------------------------------------

let serverWinRate: number | null = null

/** Server Demo win rate when this browser has one, else `fallback` (the previous local behaviour). */
export function demoWinRatePercent(fallback: number): number {
  return serverWinRate ?? fallback
}

export function setServerDemoWinRate(value: unknown): void {
  const n = value == null || value === '' ? Number.NaN : Number(value)
  serverWinRate = Number.isFinite(n) && n >= 0 && n <= 100 ? clampWinRatePercent(n) : null
}

// ---------------------------------------------------------------------------
// Supabase wiring
// ---------------------------------------------------------------------------

async function loadWinRate(): Promise<void> {
  const client = getSupabase()
  if (!client) return
  const { data, error } = await client.rpc('my_simulated_win_rate')
  if (!error) setServerDemoWinRate(data)
}

async function syncBalance(email: string): Promise<void> {
  const client = getSupabase()
  if (!client) return
  for (let attempt = 0; attempt < 2; attempt++) {
    const seen = readSeenVersion(email)
    const { data, error } = await client.rpc('sync_my_demo_balance', {
      p_balance: Math.max(0, peekDemoAvailable(email)),
      p_seen_admin_version: seen,
    })
    if (error) return
    const row = Array.isArray(data) ? (data[0] as ServerDemoRow | undefined) ?? null : null
    const step = nextSyncStep(row, seen)
    if (step.kind === 'done') return
    adoptDemoBalance(email, step.target)
    writeSeenVersion(email, step.version)
  }
}

/** Starts syncing for the signed-in Supabase user whose Demo wallet is keyed by `email`. */
export function startSimulatedSync(
  userId: string,
  email: string,
  subscribeDemoChanges: (listener: () => void) => () => void,
): () => void {
  const client = getSupabase()
  if (!client) return () => undefined
  let stopped = false
  let running: Promise<void> = Promise.resolve()
  let reportTimer: number | null = null

  const sync = () => {
    running = running.then(() => (stopped ? undefined : syncBalance(email))).catch(() => undefined)
  }
  const refreshRate = () => {
    void loadWinRate().catch(() => undefined)
  }

  sync()
  refreshRate()

  const topic = `demo-sync:${userId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
  const channel: RealtimeChannel = client
    .channel(topic)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'simulated_balances', filter: `user_id=eq.${userId}` }, (payload) => {
      const row = payload.new as { updated_by?: string } | undefined
      if (row?.updated_by === 'admin') sync()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'simulated_win_rate_overrides', filter: `user_id=eq.${userId}` }, refreshRate)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'simulation_signals' }, refreshRate)
    .subscribe()

  const poll = window.setInterval(() => {
    sync()
    refreshRate()
  }, POLL_MS)

  const unsubscribeDemo = subscribeDemoChanges(() => {
    if (reportTimer != null) window.clearTimeout(reportTimer)
    reportTimer = window.setTimeout(sync, REPORT_DEBOUNCE_MS)
  })

  return () => {
    stopped = true
    if (reportTimer != null) window.clearTimeout(reportTimer)
    window.clearInterval(poll)
    unsubscribeDemo()
    void client.removeChannel(channel)
    serverWinRate = null
  }
}
