import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || ''
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || ''
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || ''
/** Prefer the JWT anon key. Some `sb_publishable_*` values hang Auth/Data API calls from the browser. */
const supabaseKey = (anonKey.startsWith('eyJ') ? anonKey : '') || publishableKey || anonKey

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

let client: SupabaseClient<Database> | null = null

/**
 * The external Data API (/rest/v1) is slow enough to fill the browser's six
 * connections to this host and stall Auth-adjacent calls, including wallet
 * reads. Fail those reads immediately and probe in the background.
 *
 * Auth `/user` and hung Edge Function calls also need hard ceilings so the
 * trade shell does not sit on "Loading…" / "Checking your session".
 */
/** Pause only after a slow/failed REST call — do not block the first minute of wallet fallback. */
let restPausedUntil = 0
let restProbeTimer: ReturnType<typeof setTimeout> | undefined

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function pausedRestResponse(): Response {
  return new Response(
    JSON.stringify({ message: 'Data API paused', code: '57014' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  )
}

function timeoutMsFor(url: string): number {
  if (url.includes('/rest/v1/')) return 2_500
  if (url.includes('/auth/v1/user')) return 2_500
  if (url.includes('/auth/v1/token?grant_type=refresh_token')) return 3_000
  // Allow slow GoTrue (often 10–16s when degraded) without aborting a valid grant.
  if (url.includes('/auth/v1/token?grant_type=password')) return 16_000
  // REAL place/settle must reach Deriv + Postgres; under 30s aborted valid tickets.
  if (url.includes('/functions/v1/real-trade')) return 35_000
  if (url.includes('/functions/v1/admin-dashboard')) return 35_000
  if (url.includes('/functions/v1/admin-users')) return 35_000
  if (url.includes('/functions/v1/login-phone')) return 8_000
  if (url.includes('/functions/v1/')) return 12_000
  if (url.includes('/auth/v1/')) return 8_000
  return 10_000
}

function mergeAbortSignals(signals: Array<AbortSignal | null | undefined>): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(active)
  }
  const controller = new AbortController()
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

function scheduleRestProbe() {
  if (restProbeTimer !== undefined || !supabaseUrl || !supabaseKey) return
  const probe = () => {
    restProbeTimer = undefined
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2_000)
    fetch(`${supabaseUrl}/rest/v1/feature_flags?select=key&limit=1`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
      signal: ctrl.signal,
    })
      .then((res) => {
        restPausedUntil = res.status < 500 ? 0 : Date.now() + 60_000
      })
      .catch(() => {
        restPausedUntil = Date.now() + 60_000
      })
      .finally(() => {
        clearTimeout(timer)
        restProbeTimer = setTimeout(probe, 30_000)
      })
  }
  restProbeTimer = setTimeout(probe, 1_500)
}

export function dataApiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input)
  if (url.includes('/rest/v1/') && Date.now() < restPausedUntil) {
    return Promise.resolve(pausedRestResponse())
  }

  const budget = timeoutMsFor(url)
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), budget)
  const signal = mergeAbortSignals([init?.signal, timeout.signal])
  const started = Date.now()

  return fetch(input, { ...init, signal })
    .then(
      (res) => {
        if (url.includes('/rest/v1/') && Date.now() - started > 1_500) {
          restPausedUntil = Date.now() + 60_000
        }
        return res
      },
      (err: unknown) => {
        if (url.includes('/rest/v1/')) {
          restPausedUntil = Date.now() + 60_000
          scheduleRestProbe()
        }
        throw err
      },
    )
    .finally(() => clearTimeout(timer))
}

export function getSupabase(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null
  if (!client) {
    client = createClient<Database>(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        // GoTrue's automatic refresh tick, on every open tab, holds a database
        // connection until the query finishes. When PostgREST is slow those
        // sessions pile up and login plus admin stop answering. Refresh once,
        // ourselves, only when the access token is about to expire.
        autoRefreshToken: false,
        detectSessionInUrl: true,
      },
      global: { fetch: dataApiFetch },
    })
    startQuietRefresh()
  }
  return client
}

export function supabaseApiAuth(): { url: string; key: string } | null {
  if (!supabaseUrl || !supabaseKey) return null
  return { url: supabaseUrl, key: supabaseKey }
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined
let refreshInFlight = false
let refreshNotBefore = 0

function startQuietRefresh() {
  if (refreshTimer !== undefined || !supabaseUrl || !supabaseKey) return
  const tick = () => {
    refreshTimer = setTimeout(tick, 60_000)
    void refreshStoredSessionOnce()
  }
  refreshTimer = setTimeout(tick, 20_000)
}

async function refreshStoredSessionOnce(): Promise<void> {
  if (refreshInFlight || Date.now() < refreshNotBefore) return
  const parsed = readStoredAuthPayload()
  const refreshToken = parsed?.refresh_token ?? parsed?.currentSession?.refresh_token
  const expiresAt = parsed?.expires_at ?? parsed?.currentSession?.expires_at
  if (!refreshToken || typeof expiresAt !== 'number') return
  if (expiresAt * 1000 - Date.now() > 3 * 60_000) return
  refreshInFlight = true
  try {
    const response = await dataApiFetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!response.ok) {
      refreshNotBefore = Date.now() + 3 * 60_000
      return
    }
    const body = (await response.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      expires_at?: number
      token_type?: string
      user?: { id?: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> }
    }
    if (!body.access_token || !body.refresh_token) {
      refreshNotBefore = Date.now() + 3 * 60_000
      return
    }
    const host = new URL(supabaseUrl).hostname
    const ref = host.split('.')[0]
    if (!ref) return
    const expiresAtNext =
      typeof body.expires_at === 'number'
        ? body.expires_at
        : Math.floor(Date.now() / 1000) + (Number(body.expires_in) || 3600)
    localStorage.setItem(
      `sb-${ref}-auth-token`,
      JSON.stringify({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_at: expiresAtNext,
        expires_in: Number(body.expires_in) || 3600,
        token_type: body.token_type ?? 'bearer',
        user: body.user ?? parsed?.user ?? parsed?.currentSession?.user,
      }),
    )
  } catch {
    refreshNotBefore = Date.now() + 3 * 60_000
  } finally {
    refreshInFlight = false
  }
}

function readStoredAuthPayload(): {
  access_token?: string
  refresh_token?: string
  expires_at?: number
  user?: { id?: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> }
  currentSession?: {
    access_token?: string
    refresh_token?: string
    expires_at?: number
    user?: { id?: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> }
  }
} | null {
  if (!supabaseUrl) return null
  try {
    const host = new URL(supabaseUrl).hostname
    const ref = host.split('.')[0]
    if (!ref) return null
    const raw = localStorage.getItem(`sb-${ref}-auth-token`)
    if (!raw) return null
    return JSON.parse(raw) as {
      access_token?: string
      refresh_token?: string
      expires_at?: number
      user?: { id?: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> }
      currentSession?: {
        access_token?: string
        refresh_token?: string
        expires_at?: number
        user?: { id?: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> }
      }
    }
  } catch {
    return null
  }
}

/** Sync peek of the persisted Auth session so RequireAuth can render without waiting on Auth API. */
export function peekStoredAuthUser(): { id: string; email: string; created_at?: string; user_metadata?: Record<string, unknown> } | null {
  const parsed = readStoredAuthPayload()
  if (!parsed) return null
  const user = parsed.user ?? parsed.currentSession?.user
  if (!user?.id) return null
  const expiresAt = parsed.expires_at ?? parsed.currentSession?.expires_at
  if (typeof expiresAt === 'number' && expiresAt * 1000 < Date.now() - 60_000) {
    return null
  }
  return {
    id: user.id,
    email: user.email ?? '',
    created_at: user.created_at,
    user_metadata: user.user_metadata,
  }
}

/** Access token from local storage when Auth getSession hangs. */
export function peekStoredAccessToken(): string | null {
  const parsed = readStoredAuthPayload()
  if (!parsed) return null
  const expiresAt = parsed.expires_at ?? parsed.currentSession?.expires_at
  if (typeof expiresAt === 'number' && expiresAt * 1000 < Date.now() - 60_000) {
    return null
  }
  const token = parsed.access_token ?? parsed.currentSession?.access_token
  return token && token.length > 20 ? token : null
}

/** Drop the persisted Auth session so a hung GoTrue signOut cannot trap the UI. */
export function clearStoredAuthSession(): void {
  if (!supabaseUrl) return
  try {
    const host = new URL(supabaseUrl).hostname
    const ref = host.split('.')[0]
    if (!ref) return
    localStorage.removeItem(`sb-${ref}-auth-token`)
  } catch {
    /* private mode / storage blocked */
  }
}

export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    const live = getSupabase()
    if (!live) {
      throw new Error('This service is temporarily unavailable. Please try again later.')
    }
    return Reflect.get(live, prop, receiver)
  },
})
