import { useEffect, useState } from 'react'
import { useAuthSession } from '@/hooks/useAuth'
import { softTimeoutKeepGoing } from '@/lib/abort-timeout'
import { subscribeRealWalletChanged } from '@/lib/real-wallet-events'
import { safeUserMessage } from '@/lib/safe-user-message'
import { realTradingService, type RealTradingConfig } from '@/services/real-trading'
import type { AccountMode } from '@/types'

/** Paint "checking" briefly; apply late successes when Auth/edge lag past a few seconds. */
const CONFIG_PAINT_MS = 3_500

export function useRealTradingConfig(kind: AccountMode) {
  const { isSignedIn, user } = useAuthSession()
  const [config, setConfig] = useState<RealTradingConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(kind === 'real')

  useEffect(() => {
    if (kind !== 'real') return
    let cancelled = false
    const apply = (
      result: Awaited<ReturnType<typeof realTradingService.getConfig>>,
    ) => {
      if (cancelled) return
      setConfig(result.ok ? result.data : null)
      setError(
        result.ok
          ? null
          : safeUserMessage(result.error, 'Trading is temporarily unavailable.'),
      )
      setLoading(false)
    }
    const load = (force: boolean) => {
      setLoading(true)
      void softTimeoutKeepGoing(
        realTradingService.getConfig(force),
        CONFIG_PAINT_MS,
        {
          ok: false as const,
          error: 'Trading is temporarily unavailable.',
        },
        (late) => {
          if (late.ok) apply(late)
        },
      ).then(apply)
    }
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
