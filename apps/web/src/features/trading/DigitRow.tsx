import { useMemo } from 'react'
import { cn } from '@/lib/cn'
import { scanDigits } from '@/domain/digit-scanner'
import { digitsFromTicks } from '@/domain/digit-stats'
import { contractDigitWins } from '@/domain/outcome/digit-graph'
import type { TradeResultAnimationState } from '@/features/trading/trade-result-animation'
import { useAccountMode } from '@/hooks/useAccountMode'
import { useTicketChartSelection } from '@/hooks/useTicketChartSelection'
import { winRatePercentForMode } from '@/lib/trade-settings'
import { demoWinRatePercent } from '@/lib/simulated-sync'
import type { Tick } from '@/types'

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const SAMPLE_WINDOW = 100
const RING_R = 14
const RING_CIRC = 2 * Math.PI * RING_R

function digitTone(wins: boolean, current: boolean, cursor: TradeResultAnimationState['status'] | null) {
  const win = { stroke: '#00D094', text: '#00D094', track: 'rgba(0,208,148,0.22)' }
  const loss = { stroke: '#ff4d6a', text: '#ff4d6a', track: 'rgba(255,77,106,0.2)' }
  if (cursor === 'lost') return { ...loss, glow: 'drop-shadow(0 0 7px #ff4d6a)' }
  if (cursor === 'won' || cursor === 'running' || cursor === 'settling') return { ...win, glow: 'drop-shadow(0 0 7px #00c896)' }
  const tone = wins ? win : loss
  return { ...tone, glow: current ? `drop-shadow(0 0 7px ${tone.stroke})` : 'none' }
}

export function DigitRow({
  ticks,
  symbol,
  animation,
}: {
  ticks: Tick[]
  symbol: string
  animation?: TradeResultAnimationState
}) {
  const ticket = useTicketChartSelection()
  const { kind } = useAccountMode()
  const winRatePercent =
    kind === 'demo' ? demoWinRatePercent(winRatePercentForMode('demo')) : winRatePercentForMode('real')
  const anim = animation && animation.status !== 'idle' && animation.symbol === symbol ? animation : null
  const digits = useMemo(() => digitsFromTicks(ticks), [ticks])
  const scanBarrier = ticket.contractType === 'OVER_UNDER' ? ticket.barrier : 5
  const scan = useMemo(
    () =>
      scanDigits(digits, SAMPLE_WINDOW, scanBarrier, {
        contractOption: ticket.contractOption,
        selectedDigit: ticket.selectedDigit,
        barrier: ticket.barrier,
        winRatePercent,
      }),
    [digits, scanBarrier, ticket.contractOption, ticket.selectedDigit, ticket.barrier, winRatePercent],
  )
  const lastDigit = digits.length > 0 ? digits[digits.length - 1]! : null
  const counts = useMemo(() => {
    const map = new Map(scan.ranked.map((item) => [item.digit, item.count]))
    return DIGITS.map((digit) => map.get(digit) ?? 0)
  }, [scan])
  const uniform = scan.hottest.length === 10
  const maxCount = Math.max(...counts)
  const minCount = Math.min(...counts)

  return (
    <section
      aria-label="Digit statistics"
      className="px-2.5 py-2"
      data-testid="digit-sample"
      data-sample={scan.sampleSize}
      data-window={SAMPLE_WINDOW}
      data-symbol={symbol}
      data-contract-type={ticket.contractType}
      data-contract-option={ticket.contractOption}
      data-barrier={ticket.contractType === 'OVER_UNDER' ? ticket.barrier : ''}
      data-digit={ticket.contractType === 'MATCH_DIFFER' ? ticket.selectedDigit : ''}
      data-win-rate={winRatePercent}
      data-first-epoch={ticks[Math.max(0, ticks.length - SAMPLE_WINDOW)]?.epoch ?? ''}
      data-last-epoch={ticks[ticks.length - 1]?.epoch ?? ''}
    >
      <div className="relative">
        <div className="relative grid grid-cols-10 gap-1" data-testid="digit-distribution">
          {DIGITS.map((digit) => {
            const count = counts[digit] ?? 0
            const hot = scan.sampleSize > 0 && !uniform && scan.hottest.includes(digit)
            const cold = scan.sampleSize > 0 && !uniform && scan.coldest.includes(digit)
            const isCurrent = !anim && lastDigit === digit
            const cursorHere = anim?.cursorDigit === digit
            const wins = contractDigitWins(digit, ticket, winRatePercent)
            const share = scan.sampleSize > 0 ? (count / scan.sampleSize) * 100 : 0
            const fill = maxCount === minCount ? 0.55 : (count - minCount) / (maxCount - minCount)
            const tone = digitTone(wins, isCurrent, cursorHere && anim ? anim.status : null)
            return (
              <div
                key={digit}
                data-testid={`digit-card-${digit}`}
                data-count={count}
                data-current={isCurrent ? 'true' : 'false'}
                data-hot={hot ? 'true' : 'false'}
                data-cold={cold ? 'true' : 'false'}
                data-wins={wins ? 'true' : 'false'}
                aria-label={`Digit ${digit}: ${wins ? 'wins' : 'loses'} at ${winRatePercent}% admin win rate, ${count} of ${scan.sampleSize} ticks${isCurrent ? ', latest digit' : ''}`}
                className="flex flex-col items-center"
              >
                <svg
                  viewBox="0 0 40 40"
                  aria-hidden="true"
                  className="relative z-[1] h-8 w-8 sm:h-10 sm:w-10"
                  style={{ filter: tone.glow }}
                >
                  <circle cx="20" cy="20" r={RING_R} fill="none" stroke={tone.track} strokeWidth="3.5" />
                  <circle
                    cx="20"
                    cy="20"
                    r={RING_R}
                    fill="none"
                    stroke={tone.stroke}
                    strokeWidth={isCurrent || cursorHere ? 4 : 3.5}
                    strokeLinecap="round"
                    strokeDasharray={RING_CIRC}
                    strokeDashoffset={RING_CIRC - Math.max(0.12, fill) * RING_CIRC}
                    transform="rotate(-90 20 20)"
                  />
                  <text
                    x="20"
                    y="20"
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="12"
                    fontWeight="700"
                    fill={tone.text}
                  >
                    {digit}
                  </text>
                </svg>
                <span className="relative z-[1] mt-0.5 font-mono text-[10px] font-semibold tabular-nums" style={{ color: tone.text }}>
                  {share.toFixed(1)}%
                </span>
                <span aria-hidden="true" className={cn('h-2 text-[9px] leading-none', isCurrent ? '' : 'text-transparent')} style={isCurrent ? { color: tone.text } : undefined}>
                  ▲
                </span>
              </div>
            )
          })}
        </div>
        {anim && anim.cursorDigit != null ? <DigitCursor animation={anim} digit={anim.cursorDigit} /> : null}
      </div>
    </section>
  )
}

const CURSOR_TONE: Record<TradeResultAnimationState['status'], { ring: string; line: string }> = {
  idle: { ring: '', line: '' },
  running: { ring: 'border-amber shadow-[0_0_10px_rgba(251,191,36,0.55)]', line: 'bg-amber' },
  settling: { ring: 'border-amber shadow-[0_0_12px_rgba(251,191,36,0.75)]', line: 'bg-amber' },
  won: { ring: 'border-call shadow-[0_0_12px_rgba(16,185,129,0.7)]', line: 'bg-call' },
  lost: { ring: 'border-put shadow-[0_0_12px_rgba(244,63,94,0.7)]', line: 'bg-put' },
  refunded: { ring: 'border-mist', line: 'bg-mist' },
}

function DigitCursor({ animation, digit }: { animation: TradeResultAnimationState; digit: number }) {
  const tone = CURSOR_TONE[animation.status]
  return (
    <div
      aria-hidden="true"
      data-testid="digit-cursor"
      data-digit={digit}
      data-status={animation.status}
      data-trade-id={animation.tradeId ?? ''}
      className="pointer-events-none absolute inset-y-0 left-0 z-10 will-change-transform motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out"
      style={{ width: 'calc((100% - 2.25rem) / 10)', transform: `translateX(calc(${digit} * (100% + 0.25rem)))` }}
    >
      <span
        data-testid="digit-cursor-circle"
        data-digit={digit}
        className={cn('absolute left-1/2 top-[-2px] h-9 w-9 -translate-x-1/2 rounded-full border-[3px] sm:h-10 sm:w-10', tone.ring)}
      />
      <span className={cn('absolute bottom-[-2px] left-1/2 top-9 w-0.5 -translate-x-1/2 rounded-full opacity-80 sm:top-10', tone.line)} />
    </div>
  )
}