import { cn } from '@/lib/cn'

export type NavIconName =
  | 'home'
  | 'trade'
  | 'markets'
  | 'wallet'
  | 'bots'
  | 'history'
  | 'tx'
  | 'bell'
  | 'support'
  | 'profile'
  | 'verify'
  | 'lock'
  | 'admin'
  | 'search'
  | 'chevron'
  | 'plus'
  | 'minus'
  | 'zoom-in'
  | 'zoom-out'

const paths: Record<NavIconName, string> = {
  home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
  trade: 'M4 16l4-5 3 2 5-7 4 4M4 20h16',
  markets: 'M5 6h14M5 12h14M5 18h10',
  wallet: 'M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm12 5h3',
  bots: 'M9 8V6m6 2V6M8 10h8a3 3 0 0 1 3 3v5H5v-5a3 3 0 0 1 3-3zm4 4.5h.01',
  history: 'M12 7v5l3 2M5 12a7 7 0 1 0 2-5l-2 2',
  tx: 'M7 8h10M7 12h10M7 16h6',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  support: 'M12 19h.01M9 9a3 3 0 1 1 4.2 2.75c-.8.4-1.2 1-1.2 1.75V14',
  profile: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-7 8a7 7 0 1 14 0',
  verify: 'M12 3l7 3v5c0 4.2-2.8 7-7 8.5C7.8 18 5 15.2 5 11V6zm-1.2 8.2 2 2 4-4.4',
  lock: 'M8 11V8a4 4 0 0 1 8 0v3M7 11h10v8H7z',
  admin: 'M12 4l7 3v5c0 4.4-3 7.4-7 8.8C8 19.4 5 16.4 5 12V7z',
  search: 'M10.5 16.5a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm5-1.5 3.5 3.5',
  chevron: 'M8 10l4 4 4-4',
  plus: 'M12 6v12M6 12h12',
  minus: 'M6 12h12',
  'zoom-in': 'M10.5 16.5a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm5-1.5 3.5 3.5M10.5 8v5M8 10.5h5',
  'zoom-out': 'M10.5 16.5a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm5-1.5 3.5 3.5M8 10.5h5',
}

export function Icon({
  name,
  className,
}: {
  name: NavIconName
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('h-4 w-4 shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={paths[name]} />
    </svg>
  )
}
