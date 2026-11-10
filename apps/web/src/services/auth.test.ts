import { beforeEach, describe, expect, it, vi } from 'vitest'

type MemoryUser = {
  id: string
  email: string
  password: string
  name: string
  created_at: string
}

const memory = {
  users: new Map<string, MemoryUser>(),
  session: null as null | { user: { id: string; email: string; created_at: string; user_metadata: Record<string, string> } },
}

const redirects = vi.hoisted(() => ({
  signUp: null as string | null | undefined,
  reset: null as string | null | undefined,
}))

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  clearStoredAuthSession: () => {
    memory.session = null
  },
  peekStoredAuthUser: () =>
    memory.session?.user
      ? {
          id: memory.session.user.id,
          email: memory.session.user.email,
          created_at: memory.session.user.created_at,
          user_metadata: memory.session.user.user_metadata,
        }
      : null,
  async dataApiFetch(input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('/functions/v1/login-phone')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { phone?: string }
      const match = body.phone
        ? [...memory.users.values()].find((user) => user.email === 'auth-flow@example.com')
        : null
      if (!match) {
        return new Response(JSON.stringify({ email: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ email: match.email }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('/auth/v1/token?grant_type=password')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { email?: string; password?: string }
      const stored = body.email ? memory.users.get(body.email) : null
      if (!stored || stored.password !== body.password) {
        return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const user = {
        id: stored.id,
        email: stored.email,
        created_at: stored.created_at,
        user_metadata: { name: stored.name },
      }
      memory.session = { user }
      return new Response(
        JSON.stringify({
          access_token: 'test-access',
          refresh_token: 'test-refresh',
          expires_in: 3600,
          token_type: 'bearer',
          user,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ message: 'not mocked' }), { status: 404 })
  },
  getSupabase: () => ({
    auth: {
      async signUp({
        email,
        password,
        options,
      }: {
        email: string
        password: string
        options?: { data?: Record<string, string>; emailRedirectTo?: string }
      }) {
        redirects.signUp = options?.emailRedirectTo
        if (memory.users.has(email)) {
          return { data: { session: null, user: null }, error: { message: 'User already registered' } }
        }
        const id = `user_${memory.users.size + 1}`
        const created_at = new Date().toISOString()
        const name = options?.data?.name ?? email.split('@')[0]!
        memory.users.set(email, { id, email, password, name, created_at })
        const user = { id, email, created_at, user_metadata: { name, ...(options?.data ?? {}) } }
        memory.session = { user }
        return { data: { session: memory.session, user }, error: null }
      },
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        const stored = memory.users.get(email)
        if (!stored || stored.password !== password) {
          return { data: { session: null, user: null }, error: { message: 'Invalid login credentials' } }
        }
        const user = {
          id: stored.id,
          email: stored.email,
          created_at: stored.created_at,
          user_metadata: { name: stored.name },
        }
        memory.session = { user }
        return { data: { session: memory.session, user }, error: null }
      },
      async setSession() {
        return { data: { session: memory.session }, error: null }
      },
      async signOut() {
        memory.session = null
        return { error: null }
      },
      async getSession() {
        return { data: { session: memory.session }, error: null }
      },
      async resetPasswordForEmail(_email: string, options?: { redirectTo?: string }) {
        redirects.reset = options?.redirectTo
        return { error: null }
      },
      async updateUser() {
        return { data: { user: memory.session?.user ?? null }, error: null }
      },
      async resend() {
        return { error: null }
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } }
      },
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: null, error: null }
                },
              }
            },
          }
        },
      }
    },
  }),
}))

import { authService } from '@/services/auth'

describe('Supabase auth service (mocked client)', () => {
  beforeEach(() => {
    memory.users.clear()
    memory.session = null
  })

  it('signs up, restores session, signs out, and signs in', async () => {
    const signup = await authService.signUp({
      name: 'Demo Trader',
      email: 'auth-flow@example.com',
      password: 'demopass1',
      phone: '+15550001111',
      country: 'United States',
    })
    expect(signup.connected).toBe(true)
    expect(signup.data?.email).toBe('auth-flow@example.com')

    const session = await authService.getSession()
    expect(session.data?.email).toBe('auth-flow@example.com')

    await authService.signOut()
    const after = await authService.getSession()
    expect(after.data).toBeNull()

    const login = await authService.signIn({ email: 'auth-flow@example.com', password: 'demopass1' })
    expect(login.connected).toBe(true)

    const bad = await authService.signIn({ email: 'auth-flow@example.com', password: 'wrongpass1' })
    expect(bad.connected).toBe(false)
  })

  it('signs in with a phone number when the data API lookup is down', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'eyJtest')
    const signup = await authService.signUp({
      name: 'Phone Trader',
      email: 'auth-flow@example.com',
      password: 'demopass1',
      phone: '0712345678',
      country: 'Kenya',
    })
    expect(signup.connected).toBe(true)
    const login = await authService.signIn({ email: '0712345678', password: 'demopass1' })
    expect(login.connected).toBe(true)
    expect(login.data?.email).toBe('auth-flow@example.com')
    vi.unstubAllEnvs()
  })

  it('accepts password reset requests', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://optionmarkettraders.com', href: 'https://optionmarkettraders.com/forgot-password' } })
    const result = await authService.requestPasswordReset('auth-flow@example.com')
    expect(result.connected).toBe(true)
    expect(redirects.reset).toBe('https://optionmarkettraders.com/reset-password')
    vi.unstubAllGlobals()
  })

  it('sends signup confirmation to the live confirm route', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://optionmarkettraders.com/', href: 'https://optionmarkettraders.com/signup' } })
    const signup = await authService.signUp({
      name: 'Live Trader',
      email: 'confirm-route@example.com',
      password: 'demopass1',
      phone: '+15550002222',
    })
    expect(signup.connected).toBe(true)
    expect(redirects.signUp).toBe('https://optionmarkettraders.com/auth/confirm')
    vi.unstubAllGlobals()
  })

  it('updates password when a session exists', async () => {
    await authService.signUp({
      name: 'Demo Trader',
      email: 'reset-flow@example.com',
      password: 'demopass1',
    })
    const result = await authService.updatePassword('newpass12')
    expect(result.connected).toBe(true)
  })
})
