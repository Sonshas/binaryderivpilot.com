import { useEffect, useState, type CSSProperties } from 'react'
import { useLocation } from 'react-router-dom'
import { cn } from '@/lib/cn'

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const

export function ProgressTrack({ className }: { className?: string }) {
  return (
    <div className={cn('sbb-load-track w-full', className)} aria-hidden="true">
      <span />
    </div>
  )
}

export function ProgressLoader({
  label = 'Loading',
  layout = 'page',
}: {
  label?: string
  layout?: 'page' | 'inline'
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-paper',
        layout === 'page' ? 'min-h-svh bg-ink px-4 sbb-glow' : 'w-full gap-3 py-8',
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="progress-loader"
    >
      <div className="sbb-digit-run flex items-center justify-center gap-0.5 sm:gap-1" aria-hidden="true">
        {DIGITS.map((digit) => (
          <span
            key={digit}
            style={{ '--digit-index': digit } as CSSProperties}
            className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-line font-display text-[11px] font-semibold text-mist sm:h-8 sm:w-8 sm:text-sm"
          >
            {digit}
          </span>
        ))}
      </div>
      <ProgressTrack className="mt-4 max-w-[220px]" />
      <p className="mt-3 font-mono text-[11px] tracking-[0.18em] text-mist uppercase">{label}</p>
    </div>
  )
}

export function RouteProgress() {
  const location = useLocation()
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(true)
    setWidth(16)
    const mid = window.setTimeout(() => setWidth(68), 120)
    const done = window.setTimeout(() => setWidth(100), 420)
    const hide = window.setTimeout(() => {
      setVisible(false)
      setWidth(0)
    }, 700)
    return () => {
      window.clearTimeout(mid)
      window.clearTimeout(done)
      window.clearTimeout(hide)
    }
  }, [location.key])

  if (!visible) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={width} aria-label="Loading page">
      <div
        className="h-full bg-gradient-to-r from-signal-strong to-sky shadow-[0_0_12px_rgb(59_130_246_/_0.65)] transition-[width] duration-300 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  )
}
