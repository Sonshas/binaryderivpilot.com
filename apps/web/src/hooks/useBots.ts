import { useEffect, useState } from 'react'
import { useAccountMode } from '@/hooks/useAccountMode'
import { isTradeResultNotification, loadDemoState, subscribeDemoStore } from '@/lib/demo-store'
import { subscribeSupportChanged } from '@/lib/support-events'
import { e2eAuthBypassEnabled } from '@/services/auth'
import { notificationService, supportService } from '@/services/notifications'
import type { Notification, SupportTicket } from '@/types'

export function useNotifications() {
  const { kind } = useAccountMode()
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (kind === 'demo' || e2eAuthBypassEnabled) return
    return subscribeSupportChanged(() => setRefreshKey((value) => value + 1))
  }, [kind])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const load = () => {
      if (e2eAuthBypassEnabled) {
        if (cancelled) return
        setItems(loadDemoState().notifications.filter((item) => !isTradeResultNotification(item.title)))
        setLoading(false)
        return
      }
      void notificationService.list(kind).then((result) => {
        if (cancelled) return
        setItems((kind === 'demo' ? loadDemoState().notifications : result.data).filter((item) => !isTradeResultNotification(item.title)))
        setLoading(false)
      })
    }

    load()
    const unsubscribe = e2eAuthBypassEnabled || kind === 'demo' ? subscribeDemoStore(load) : () => undefined
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [kind, refreshKey])

  return { items, loading }
}

export function useSupportTickets() {
  const { kind } = useAccountMode()
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (kind === 'demo' || e2eAuthBypassEnabled) return
    return subscribeSupportChanged(() => setRefreshKey((value) => value + 1))
  }, [kind])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const load = () => {
      if (e2eAuthBypassEnabled) {
        if (cancelled) return
        setTickets(loadDemoState().tickets)
        setLoading(false)
        return
      }
      void supportService.listTickets(kind).then((result) => {
        if (cancelled) return
        setTickets(kind === 'demo' ? loadDemoState().tickets : result.data)
        setLoading(false)
      })
    }

    load()
    const unsubscribe = e2eAuthBypassEnabled || kind === 'demo' ? subscribeDemoStore(load) : () => undefined
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [kind, refreshKey])

  return { tickets, loading }
}
