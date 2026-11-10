import { useEffect, useState } from 'react'
import { useAuthSession } from '@/hooks/useAuth'
import { adminPanelService } from '@/services/admin-panel'

export type SuperadminState = 'checking' | 'yes' | 'no'

/** Asks the server (public.is_superadmin) whether the signed-in account is the superadmin. */
export function useSuperadmin(): SuperadminState {
  const { user, loading } = useAuthSession()
  const [state, setState] = useState<SuperadminState>('checking')
  const userId = user?.id ?? null

  useEffect(() => {
    if (loading) return
    if (!userId) {
      setState('no')
      return
    }
    let cancelled = false
    setState('checking')
    // Defer so /admin dashboard can claim the pooler before this RPC.
    const timer = globalThis.setTimeout(() => {
      void adminPanelService.isSuperadmin().then(
        (yes) => {
          if (!cancelled) setState(yes ? 'yes' : 'no')
        },
        () => {
          if (!cancelled) setState('no')
        },
      )
    }, 2_500)
    return () => {
      cancelled = true
      globalThis.clearTimeout(timer)
    }
  }, [loading, userId])

  return state
}
