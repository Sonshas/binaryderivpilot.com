import { useState } from 'react'
import { predictionLabel, type TradeResultAnimationState } from '@/features/trading/trade-result-animation'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/cn'

type NoticeTone = 'placed' | 'won' | 'lost' | 'refunded'

interface TradeNoticeModel {
  tone: NoticeTone
  title: string
  detail: string
}

const TONE_CLASS: Record<NoticeTone, string> = {
  placed: 'border-signal/50 bg-[#132033] text-signal-soft',
  won: 'border-call/50 bg-[#052e16] text-call',
  lost: 'border-put/50 bg-[#450a0a] text-put-soft',
  refunded: 'border-amber/50 bg-[#422006] text-amber',
}

const BAR_CLASS: Record<NoticeTone, string> = {
  placed: 'bg-signal',
  won: 'bg-call',
  lost: 'bg-put',
  refunded: 'bg-amber',
}

export function tradeNotice(animation: TradeResultAnimationState): TradeNoticeModel | null {
  if (animation.status === 'idle') return null
  const label = animation.selection ? predictionLabel(animation.selection) : 'Trade'
  const stake = formatMoney(animation.stake)
  if (animation.status === 'running' || animation.status === 'settling') {
    return { tone: 'placed', title: 'Trade placed', detail: `${label} · ${stake}` }
  }
  if (animation.status === 'won') {
    const profit =
      animation.profitLoss ??
      (animation.payout != null && animation.stake != null ? Number((animation.payout - animation.stake).toFixed(2)) : null)
    const amount = profit == null ? '' : `+${formatMoney(Math.abs(profit))}`
    const digit = animation.settledDigit
    return {
      tone: 'won',
      title: amount ? `Won ${amount}` : 'Won',
      detail: digit == null ? label : `${label} · digit ${digit}`,
    }
  }
  if (animation.status === 'lost') {
    const digit = animation.settledDigit
    return {
      tone: 'lost',
      title: `Lost -${stake}`,
      detail: digit == null ? label : `${label} · digit ${digit}`,
    }
  }
  return { tone: 'refunded', title: 'Stake returned', detail: `${label} · ${stake}` }
}

export function TradeNotice({ animation }: { animation: TradeResultAnimationState }) {
  const notice = tradeNotice(animation)
  const key = notice ? `${animation.tradeId ?? ''}:${notice.tone}` : ''
  const [closed, setClosed] = useState('')
  if (!notice || closed === key) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="trade-notice"
      data-tone={notice.tone}
      className={cn(
        'pointer-events-auto fixed right-3 top-[4.25rem] z-30 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border px-4 py-3 shadow-[0_12px_32px_rgba(0,0,0,0.55)]',
        TONE_CLASS[notice.tone],
      )}
    >
      <span className={cn('absolute inset-y-0 left-0 w-1', BAR_CLASS[notice.tone])} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3 pl-2">
        <div>
          <p className="font-mono text-sm font-semibold">{notice.title}</p>
          <p className="mt-0.5 text-xs text-paper/80">{notice.detail}</p>
        </div>
        <button
          type="button"
          className="text-paper/70 hover:text-paper"
          aria-label="Dismiss notice"
          onClick={() => setClosed(key)}
        >
          ×
        </button>
      </div>
    </div>
  )
}
