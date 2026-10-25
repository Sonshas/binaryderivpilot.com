import { useCallback, useEffect, useState } from 'react'
import { systemIssuesService, type SystemHealth } from '@/services/system-issues'

export function useSystemHealth(pollMs = 60_000) {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const result = await systemIssuesService.load()
      if (result.ok) {
        setHealth(result.data)
        setError('')
      } else {
        setError(result.error)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'System health could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    if (!pollMs) return
    const timer = window.setInterval(() => void refresh(), pollMs)
    return () => window.clearInterval(timer)
  }, [refresh, pollMs])

  const failingProbes = health?.probes.filter((probe) => !probe.ok) ?? []
  const problemCount = (health?.open.length ?? 0) + failingProbes.length + (error ? 1 : 0)

  return { health, error, loading, refresh, failingProbes, problemCount }
}
