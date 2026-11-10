import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { authService } from '@/services/auth'
import type { ProviderResult, User } from '@/types'

interface AuthContextValue {
  user: User | null
  isSignedIn: boolean
  loading: boolean
  message: string
  authService: typeof authService
  refresh: () => Promise<void>
  /** Apply a known session immediately (after password grant) without waiting on Auth locks. */
  acceptUser: (next: User | null, nextMessage?: string) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const peeked = authService.peekSession()
  const [user, setUser] = useState<User | null>(peeked)
  // If we already have a persisted session, do not block the app shell.
  const [loading, setLoading] = useState(!peeked)
  const [message, setMessage] = useState(
    peeked ? `Session active for ${peeked.email}.` : '',
  )

  const refresh = useCallback(async () => {
    // Prefer local storage first so a hung getSession after password grant
    // cannot bounce RequireAuth back to /login.
    const peeked = authService.peekSession()
    if (peeked) {
      setUser(peeked)
      setMessage(`Session active for ${peeked.email}.`)
      setLoading(false)
    }
    try {
      const result = await authService.getSession()
      setUser(result.data)
      setMessage(result.message)
    } catch {
      if (!authService.peekSession()) {
        setUser(null)
        setMessage('Sign-in is temporarily unavailable.')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const acceptUser = useCallback((next: User | null, nextMessage?: string) => {
    setUser(next)
    setLoading(false)
    setMessage(
      nextMessage ??
        (next ? `Session active for ${next.email}.` : 'No active session.'),
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    // Hard ceiling so AuthLayout never sticks on "Checking your session".
    const ceiling = globalThis.setTimeout(() => {
      if (cancelled) return
      setLoading(false)
      if (!authService.peekSession()) {
        setUser(null)
        setMessage('Sign-in is temporarily unavailable.')
      }
    }, 3_500)
    void authService
      .getSession()
      .then((result) => {
        if (cancelled) return
        const peeked = authService.peekSession()
        if (!result.data && peeked) {
          setUser(peeked)
          setMessage(`Session active for ${peeked.email}.`)
          return
        }
        setUser(result.data)
        setMessage(result.message)
      })
      .catch(() => {
        if (cancelled) return
        if (!authService.peekSession()) {
          setUser(null)
          setMessage('Sign-in is temporarily unavailable.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    const unsubscribe = authService.onAuthStateChange((next) => {
      if (cancelled) return
      if (!next) {
        const peeked = authService.peekSession()
        if (peeked) {
          setUser(peeked)
          setLoading(false)
          setMessage(`Session active for ${peeked.email}.`)
          return
        }
      }
      setUser(next)
      setLoading(false)
      setMessage(next ? `Session active for ${next.email}.` : 'No active session.')
    })
    return () => {
      cancelled = true
      globalThis.clearTimeout(ceiling)
      unsubscribe()
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      isSignedIn: Boolean(user),
      loading,
      message,
      authService,
      refresh,
      acceptUser,
    }),
    [user, loading, message, refresh, acceptUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthSession(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuthSession must be used within AuthProvider')
  }
  return ctx
}

export function useDemoSession() {
  const { user, isSignedIn } = useAuthSession()
  return { user, isSignedIn }
}

export function useAuthAction() {
  const { refresh } = useAuthSession()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ProviderResult<User | null> | null>(null)

  const run = useCallback(
    async (fn: () => Promise<ProviderResult<User | null | undefined> | ProviderResult<null>>) => {
      setLoading(true)
      setResult(null)
      const next = await fn()
      setResult({
        ...next,
        data: (next.data as User | null) ?? null,
      })
      await refresh()
      setLoading(false)
      return next
    },
    [refresh],
  )

  return { loading, result, run, authService }
}
