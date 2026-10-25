import { Outlet, matchPath, useLocation } from 'react-router-dom'
import { TRADE_ROUTE } from '@/lib/auth-redirect'
import { cn } from '@/lib/cn'
import { AppTopBar } from '@/layouts/AppTopBar'
import { SimulatedSync } from '@/components/SimulatedSync'

export function AppLayout() {
  const location = useLocation()
  const isTrade = Boolean(matchPath({ path: TRADE_ROUTE, end: true }, location.pathname))

  return (
    <div className="flex h-svh flex-col bg-ink text-paper">
      <AppTopBar />
      <SimulatedSync />
      <main
        className={cn(
          'w-full min-w-0 flex-1 overflow-hidden',
          isTrade
            ? 'flex min-h-0 flex-col overflow-y-auto md:pb-0 lg:overflow-hidden'
            : 'overflow-y-auto px-3 pt-4 pb-6 sm:px-4',
        )}
      >
        <Outlet />
      </main>
    </div>
  )
}
