import { useEffect, useState } from 'react'
import { useAuthSession } from '@/hooks/useAuth'
import { subscribeRealWalletChanged } from '@/lib/real-wallet-events'
import { safeUserMessage } from '@/lib/safe-user-message'
import { realTradingService, type RealTradingConfig } from '@/services/real-trading'
import type { AccountMode } from '@/types'

export function useRealTradingConfig(kind: AccountMode) {
  const { isSignedIn, user } = useAuthSession()
  const [config, setConfig] = useState<RealTradingConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(kind === 'real')

  useEffect(() => {
    if (kind !== 'real') return
    let cancelled = false
    const load = (force: boolean) =>
      realTradingService.getConfig(force).then((result) => {
        if (cancelled) return
        setConfig(result.ok ? result.data : null)
        setError(result.ok ? null : safeUserMessage(result.error, 'Trading is temporarily unavailable.'))
        setLoading(false)
      })
    setLoading(true)
    void load(false)
    const unsubscribe = subscribeRealWalletChanged(() => void load(true))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [kind, isSignedIn, user?.id])

  return {
    config,
    enabled: kind === 'real' && config?.enabled === true,
    loading: kind === 'real' && loading,
    error,
  }
}
