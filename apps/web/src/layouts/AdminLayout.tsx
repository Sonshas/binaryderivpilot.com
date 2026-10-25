import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/brand/Logo'
import { Badge } from '@/components/ui'
import { SystemIssuesBanner } from '@/features/admin/SystemIssuesBanner'
import { useAuthSession } from '@/hooks/useAuth'
import { useSuperadmin } from '@/hooks/useSuperadmin'
import { cn } from '@/lib/cn'
import { ADMIN_NAV, SUPERADMIN_NAV } from '@/lib/constants'

function AdminLinks({ onSelect }: { onSelect?: () => void }) {
  const superadmin = useSuperadmin() === 'yes'
  const items = superadmin ? [ADMIN_NAV[0], SUPERADMIN_NAV, ...ADMIN_NAV.slice(1)] : ADMIN_NAV
  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={'end' in item ? item.end : false}
          onClick={onSelect}
          className={({ isActive }) =>
            cn(
              'rounded-lg px-3 py-2 text-sm text-mist hover:bg-surface-2 hover:text-paper',
              isActive && 'bg-surface-2 text-paper',
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </div>
  )
}

export function AdminLayout() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { authService } = useAuthSession()

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  async function logout() {
    setOpen(false)
    await authService.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-ink text-paper">
      <header className="sticky top-0 z-40 border-b border-line bg-ink/90 backdrop-blur-md">
        <div className="flex h-14 items-center gap-3 px-4">
          <Logo compact to="/admin" />
          <span className="font-display text-sm font-semibold">Admin</span>
          <Badge tone="signal">Admin</Badge>
          <NavLink to="/app/trade" className="ml-auto hidden text-sm text-mist hover:text-paper sm:inline">
            User app
          </NavLink>
          <NavLink to="/" className="hidden text-sm text-mist hover:text-paper sm:inline">
            Home
          </NavLink>
          <button
            type="button"
            className="text-sm text-put hover:text-paper"
            onClick={() => void logout()}
            data-testid="admin-logout"
          >
            Log out
          </button>
        </div>
      </header>
      <SystemIssuesBanner />
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-56 shrink-0 overflow-y-auto border-r border-line bg-ink-2 p-3 lg:block">
          <AdminLinks />
        </nav>
        <div className="sbb-scroll min-w-0 flex-1 overflow-y-auto">
          <div className="px-4 pt-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
            <Outlet />
          </div>
        </div>
      </div>
      <button
        type="button"
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-ink-2 text-paper shadow-2xl lg:hidden"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open ? (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button type="button" className="absolute inset-0 h-full w-full bg-black/60" aria-label="Close menu backdrop" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col border-r border-line bg-ink-2 shadow-2xl" role="dialog" aria-modal="true" aria-label="Admin menu">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-line pl-4 pr-3">
              <Logo compact to="/admin" />
              <Badge tone="signal">Admin</Badge>
            </div>
            <div className="flex flex-wrap gap-4 border-b border-line px-4 py-3 text-sm">
              <NavLink to="/app/trade" className="text-mist hover:text-paper" onClick={() => setOpen(false)}>
                User app
              </NavLink>
              <NavLink to="/" className="text-mist hover:text-paper" onClick={() => setOpen(false)}>
                Home
              </NavLink>
              <button
                type="button"
                className="text-put hover:text-paper"
                onClick={() => void logout()}
                data-testid="admin-logout-mobile"
              >
                Log out
              </button>
            </div>
            <nav className="sbb-scroll min-h-0 flex-1 overflow-y-auto p-3" aria-label="Admin">
              <AdminLinks onSelect={() => setOpen(false)} />
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  )
}
