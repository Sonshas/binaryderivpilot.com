import { useEffect, useState, type ReactNode } from 'react'
import { StatusErrorPage } from '@/pages/errors/ErrorPage'

export function OfflineGate({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  useEffect(() => {
    const markOnline = () => setOnline(true)
    const markOffline = () => setOnline(false)
    window.addEventListener('online', markOnline)
    window.addEventListener('offline', markOffline)
    return () => {
      window.removeEventListener('online', markOnline)
      window.removeEventListener('offline', markOffline)
    }
  }, [])

  return (
    <>
      <div inert={online ? undefined : true} aria-hidden={online ? undefined : true}>
        {children}
      </div>
      {online ? null : (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-ink" role="alertdialog" aria-modal="true" aria-labelledby="offline-title">
          <StatusErrorPage kind="offline" titleId="offline-title" onRetry={() => setOnline(navigator.onLine)} />
        </div>
      )}
    </>
  )
}
