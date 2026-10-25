import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, matchPath, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/brand/Logo'
import { isAdminEmail } from '@/lib/admin-emails'
import { Icon, type NavIconName } from '@/components/icons'
import { useAccountMode } from '@/hooks/useAccountMode'
import { useAuthSession } from '@/hooks/useAuth'
import { useNotifications, useSupportTickets } from '@/hooks/useBots'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useWallet } from '@/hooks/useWallet'
import { TRADE_ROUTE } from '@/lib/auth-redirect'
import { cn } from '@/lib/cn'
import { APP_DRAWER_NAV, APP_TOP_NAV, PROFILE_MENU_NAV } from '@/lib/constants'
import { accountShortName, accountUpper } from '@/lib/branding'
import { formatMoney } from '@/lib/format'

function useDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close, ref])
}

function isActivePath(pathname: string, to: string): boolean {
  return Boolean(matchPath({ path: to, end: false }, pathname))
}

function useAccountSummary() {
  const { kind, setKind } = useAccountMode()
  const { wallet, balanceDisplay } = useWallet(kind)
  const { user, isSignedIn, authService } = useAuthSession()
  const { items } = useNotifications()
  const isDemo = kind === 'demo'
  const balance = isDemo ? formatMoney(wallet?.availableBalance ?? null) : balanceDisplay
  const name = user?.name?.trim() || user?.email?.split('@')[0] || 'Trader'
  const unread = items.filter((item) => !item.read).length
  return { kind, setKind, isDemo, balance, user, isSignedIn, authService, name, unread }
}

type AccountSummary = ReturnType<typeof useAccountSummary>

function initials(name: string): string {
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? 'T') + (parts[1]?.[0] ?? '')).toUpperCase()
}

function ModeSwitch({ account, size }: { account: AccountSummary; size: 'sm' | 'touch' }) {
  const { isDemo, setKind } = account
  const button =
    size === 'touch'
      ? 'h-11 px-2.5 text-[11px] min-[400px]:px-3 min-[400px]:text-xs'
      : 'h-8 px-2 text-[10px] min-[380px]:px-2.5 min-[380px]:text-[11px]'
  return (
    <div
      className={cn(
        'flex shrink-0 rounded-full border',
        size === 'sm' && 'p-0.5',
        isDemo ? 'border-demo/40 bg-demo/10' : 'border-live/50 bg-live/10',
      )}
      role="group"
      aria-label="Account mode"
      data-testid="mode-switch"
    >
      <button
        type="button"
        className={cn('rounded-full font-bold uppercase tracking-wide', button, isDemo ? 'bg-demo text-ink' : 'text-mist')}
        aria-pressed={isDemo}
        onClick={() => setKind('demo')}
      >
        {accountShortName('demo')}
      </button>
      <button
        type="button"
        className={cn('rounded-full font-bold uppercase tracking-wide', button, !isDemo ? 'bg-live text-white' : 'text-mist')}
        aria-pressed={!isDemo}
        onClick={() => setKind('real')}
      >
        {accountShortName('real')}
      </button>
    </div>
  )
}

function BalanceBlock({ account }: { account: AccountSummary }) {
  return (
    <div className="shrink-0 whitespace-nowrap leading-tight" data-testid="topbar-balance">
      <p className={cn('text-[9px] font-bold tracking-[0.14em]', account.isDemo ? 'text-demo' : 'text-live')}>
        {accountUpper(account.kind)}
      </p>
      <p className="font-mono text-xs font-semibold text-paper">{account.balance}</p>
    </div>
  )
}

function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null
  return (
    <span
      className={cn(
        'flex h-4 min-w-4 items-center justify-center rounded-full bg-put px-1 text-[10px] font-bold leading-none text-white',
        className,
      )}
      data-testid="unread-badge"
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}

function NotificationBell({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(() => setOpen(false)).current
  const { pathname } = useLocation()
  const { items } = useNotifications()
  const { tickets } = useSupportTickets()
  useDismiss(open, close, ref)
  const supportUnread = tickets.some((ticket) => ticket.reply && ticket.replyRead !== true)
  const recent = items
    .filter((item) => !(supportUnread && item.title === 'New support reply' && !item.read))
    .slice(0, 5)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-surface-2',
          open ? 'bg-signal/10 text-signal' : 'text-mist hover:text-paper',
        )}
        onClick={() => setOpen((value) => !value)}
        data-testid="topbar-bell"
      >
        <Icon name="bell" className="h-5 w-5" />
        <UnreadBadge count={unread} className="absolute right-1 top-1" />
      </button>
      {open ? (
        <div
          className={cn(menuPanel, 'w-80 max-w-[calc(100vw-1rem)] p-0')}
          role="menu"
          aria-label="Notifications"
          data-testid="notifications-menu"
        >
          <p className="border-b border-line/70 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-mist">Notifications</p>
          {supportUnread ? (
            <Link
              to="/app/support"
              role="menuitem"
              onClick={close}
              className="block border-b border-signal/30 bg-signal/15 px-3 py-2.5 text-sm font-semibold text-signal no-underline"
              data-testid="support-reply-notice"
            >
              You have a new support message.
            </Link>
          ) : null}
          {recent.length === 0 && !supportUnread ? (
            <p className="px-3 py-3 text-sm text-mist">No notifications yet</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {recent.map((item) => (
                <li key={item.id} className="border-b border-line/50 px-3 py-2 last:border-b-0">
                  <p className={cn('truncate text-sm', item.read ? 'text-mist' : 'font-semibold text-paper')}>{item.title}</p>
                  <p className="mt-0.5 truncate text-xs text-mist">{item.body}</p>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/app/notifications"
            role="menuitem"
            onClick={close}
            className="block border-t border-line/70 px-3 py-2 text-center text-xs font-semibold text-signal no-underline hover:bg-surface-2"
          >
            All notifications
          </Link>
        </div>
      ) : null}
    </div>
  )
}

function MenuLink({ to, icon, children, onSelect }: { to: string; icon: NavIconName; children: ReactNode; onSelect: () => void }) {
  return (
    <NavLink
      to={to}
      role="menuitem"
      onClick={onSelect}
      className={({ isActive }) =>
        cn(
          'flex min-h-10 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm hover:bg-surface-2',
          isActive ? 'bg-signal/10 font-semibold text-signal!' : 'text-mist! hover:text-paper!',
        )
      }
    >
      <Icon name={icon} />
      {children}
    </NavLink>
  )
}

const menuPanel =
  'absolute right-0 top-[calc(100%+6px)] z-[70] min-w-48 rounded-xl border border-line bg-ink-2 p-1.5 shadow-2xl shadow-black/40'

function ProfileMenu({ account, compact }: { account: AccountSummary; compact: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const close = useRef(() => setOpen(false)).current
  useDismiss(open, close, ref)
  const isAdmin = isAdminEmail(account.user?.email)

  async function logout() {
    setOpen(false)
    await account.authService.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        className={cn(
          'flex h-11 items-center gap-2 rounded-xl hover:bg-surface-2',
          compact ? 'px-1.5' : 'px-2',
          open && 'bg-surface-2',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((value) => !value)}
        data-testid="profile-menu-button"
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-signal/15 text-xs font-bold text-signal"
          aria-hidden
        >
          {initials(account.name)}
        </span>
        {!compact ? (
          <span className="hidden max-w-[8rem] truncate text-sm font-medium text-paper lg:block" data-testid="profile-name">
            {account.name}
          </span>
        ) : null}
        <Icon name="chevron" className={cn('text-mist transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className={menuPanel} role="menu" aria-label="Account">
          <div className="border-b border-line/70 px-3 pb-2 pt-1.5">
            <p className="truncate text-sm font-semibold text-paper">
              {account.name}
            </p>
            {account.user?.email ? <p className="max-w-56 truncate text-[11px] text-mist">{account.user.email}</p> : null}
            {compact ? (
              <p className={cn('mt-1 text-[10px] font-bold tracking-[0.14em]', account.isDemo ? 'text-demo' : 'text-live')}>
                {accountUpper(account.kind)}
              </p>
            ) : null}
          </div>
          <div className="pt-1">
            {PROFILE_MENU_NAV.map((item) => (
              <MenuLink key={item.to} to={item.to} icon={item.icon} onSelect={close}>
                {item.label}
              </MenuLink>
            ))}
            {isAdmin ? (
              <MenuLink to="/admin" icon="admin" onSelect={close}>
                <span data-testid="admin-menu-link">Admin</span>
              </MenuLink>
            ) : null}
          </div>
          <div className="mt-1 border-t border-line/70 pt-1">
            {account.isSignedIn ? (
              <button
                type="button"
                role="menuitem"
                className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-put hover:bg-put/10"
                onClick={() => void logout()}
              >
                <Icon name="lock" />
                Log out
              </button>
            ) : (
              <MenuLink to="/login" icon="profile" onSelect={close}>
                Log in
              </MenuLink>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function topLinkClass(isActive: boolean) {
  return cn(
    'relative flex h-10 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium',
    isActive
      ? 'bg-signal/10 text-signal! hover:bg-signal/15 after:absolute after:inset-x-3 after:-bottom-[9px] after:h-0.5 after:rounded-full after:bg-signal'
      : 'text-mist! hover:bg-surface-2 hover:text-paper!',
  )
}

function MoreMenu({ items, pathname }: { items: readonly (typeof APP_TOP_NAV)[number][]; pathname: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(() => setOpen(false)).current
  useDismiss(open, close, ref)
  if (items.length === 0) return null
  const active = items.some((item) => isActivePath(pathname, item.to))
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        className={cn(topLinkClass(active), 'gap-1')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-current={active ? 'page' : undefined}
        onClick={() => setOpen((value) => !value)}
        data-testid="nav-more"
      >
        More
        <Icon name="chevron" className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className={cn(menuPanel, 'left-0 right-auto')} role="menu" aria-label="More pages">
          {items.map((item) => (
            <MenuLink key={item.to} to={item.to} icon={item.icon} onSelect={close}>
              {item.label}
            </MenuLink>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function DesktopBar({ account }: { account: AccountSummary }) {
  const { pathname } = useLocation()
  const isXl = useMediaQuery('(min-width: 1280px)')
  const inline = (item: (typeof APP_TOP_NAV)[number]) => item.inlineFrom === 'md' || isXl
  const inlineItems = APP_TOP_NAV.filter(inline)
  const moreItems = APP_TOP_NAV.filter((item) => !inline(item))

  return (
    <div className="flex h-14 items-center gap-2 px-3 lg:gap-3 lg:px-4" data-testid="topbar-desktop">
      <Logo compact to={TRADE_ROUTE} className="mr-1 shrink-0 lg:mr-3" />
      <nav className="flex min-w-0 items-center gap-0.5" aria-label="Main" data-testid="top-nav">
        {inlineItems.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => topLinkClass(isActive)}>
            {item.label}
          </NavLink>
        ))}
        <MoreMenu items={moreItems} pathname={pathname} />
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-2 lg:gap-3">
        <div className="flex items-center gap-2.5 border-l border-line pl-2 lg:pl-3">
          <ModeSwitch account={account} size="sm" />
          <BalanceBlock account={account} />
        </div>
        <NotificationBell unread={account.unread} />
        <ProfileMenu account={account} compact={false} />
      </div>
    </div>
  )
}

function MobileDrawer({ account, onClose, returnFocus }: { account: AccountSummary; onClose: () => void; returnFocus: RefObject<HTMLButtonElement | null> }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const focusTarget = returnFocus.current
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
      focusTarget?.focus()
    }
  }, [onClose, returnFocus])

  return createPortal(
    <div className="fixed inset-0 z-[60] md:hidden" data-testid="mobile-drawer">
      <button
        type="button"
        className="absolute inset-0 h-full w-full bg-black/60"
        aria-label="Close menu backdrop"
        tabIndex={-1}
        onClick={onClose}
        data-testid="mobile-drawer-backdrop"
      />
      <div
        className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col border-r border-line bg-ink-2 pb-[env(safe-area-inset-bottom)] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line pl-4 pr-1.5">
          <Logo compact to={TRADE_ROUTE} />
          <button
            ref={closeRef}
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-mist hover:bg-surface-2 hover:text-paper"
            aria-label="Close menu"
            onClick={onClose}
            data-testid="mobile-drawer-close"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="shrink-0 border-b border-line/70 px-4 py-3">
          <p className="truncate text-sm font-semibold text-paper">{account.name}</p>
          {account.user?.email ? <p className="max-w-full truncate text-[11px] text-mist">{account.user.email}</p> : null}
        </div>
        <nav className="sbb-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" aria-label="Mobile menu">
          {APP_DRAWER_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium hover:bg-surface-2',
                  isActive ? 'bg-signal/10 text-signal!' : 'text-mist! hover:text-paper!',
                )
              }
            >
              <Icon name={item.icon} className="h-5 w-5" />
              <span className="flex-1">{item.label}</span>
              {item.to === '/app/notifications' ? <UnreadBadge count={account.unread} /> : null}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>,
    document.body,
  )
}

function MobileBar({ account }: { account: AccountSummary }) {
  const [open, setOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const { pathname } = useLocation()
  const close = useRef(() => setOpen(false)).current

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <>
      <div className="flex h-14 items-center gap-1.5 px-2 min-[380px]:gap-2 min-[380px]:px-3" data-testid="topbar-mobile">
        <button
          ref={menuButton}
          type="button"
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-paper hover:bg-surface-2"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          data-testid="mobile-menu-button"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          {account.unread > 0 ? <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-put" aria-hidden /> : null}
        </button>
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1 min-[360px]:gap-1.5 min-[400px]:gap-2">
          <ModeSwitch account={account} size="sm" />
          <BalanceBlock account={account} />
          <div className="hidden min-[360px]:block">
            <NotificationBell unread={account.unread} />
          </div>
          <ProfileMenu account={account} compact />
        </div>
      </div>
      {open ? <MobileDrawer account={account} onClose={close} returnFocus={menuButton} /> : null}
    </>
  )
}

export function AppTopBar() {
  const account = useAccountSummary()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  return (
    <header
      className={cn(
        'sticky top-0 z-40 shrink-0 border-b bg-ink/90 backdrop-blur-md',
        account.isDemo ? 'border-line' : 'border-live/50',
      )}
      data-testid="app-topbar"
    >
      {isDesktop ? <DesktopBar account={account} /> : <MobileBar account={account} />}
    </header>
  )
}
