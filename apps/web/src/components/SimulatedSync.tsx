import { useEffect, useState } from 'react'
import { useAuthSession } from '@/hooks/useAuth'
import { subscribeDemoStore } from '@/lib/demo-store'
import { loadDemoSession } from '@/lib/demo-session'
import { startSimulatedSync } from '@/lib/simulated-sync'
import { getSupabase } from '@/lib/supabase'

/** Mounted once in the trader layout; renders nothing. */
export function SimulatedSync() {
  const { user } = useAuthSession()
  const [account, setAccount] = useState<{ id: string; email: string } | null>(null)

  useEffect(() => {
    const client = getSupabase()
    if (!client || !user) {
      setAccount(null)
      return
    }
    let cancelled = false
    void client.auth.getSession().then(({ data }) => {
      if (cancelled) return
      const sbUser = data.session?.user
      const sbEmail = sbUser?.email?.trim().toLowerCase()
      const demoEmail = loadDemoSession()?.email?.trim().toLowerCase()
      setAccount(sbUser && sbEmail && sbEmail === demoEmail ? { id: sbUser.id, email: sbEmail } : null)
    })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (!account) return
    return startSimulatedSync(account.id, account.email, subscribeDemoStore)
  }, [account])

  return null
}
