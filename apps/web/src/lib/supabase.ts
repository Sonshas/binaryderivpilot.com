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
  // Password grant must fail fast so the login button never sticks on "Signing in…".
  if (url.includes('/auth/v1/token?grant_type=password')) return 8_000
  // REAL place/settle must reach Deriv + Postgres; under 30s aborted valid tickets.
  if (url.includes('/functions/v1/real-trade')) return 35_000
  if (url.includes('/functions/v1/admin-dashboard')) return 22_000
  if (url.includes('/functions/v1/admin-users')) return 22_000
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
        if (url.includes('/rest/v1/')) restPausedUntil = Date.now() + 60_000
        throw err
      },
    )
    .finally(() => clearTimeout(timer))
}

export function getSupabase(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null
  if (!client) {
    scheduleRestProbe()
    client = createClient<Database>(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: { fetch: dataApiFetch },
    })
  }
  return client
}

function readStoredAuthPayload(): {
  access_token?: string
  expires_at?: number
  user?: { id?: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> }
  currentSession?: {
    access_token?: string
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
      expires_at?: number
      user?: { id?: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> }
      currentSession?: {
        access_token?: string
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

export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    const live = getSupabase()
    if (!live) {
      throw new Error('This service is temporarily unavailable. Please try again later.')
    }
    return Reflect.get(live, prop, receiver)
  },
})
