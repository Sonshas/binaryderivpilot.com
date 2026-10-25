import { useEffect, useState, type ReactNode } from 'react'
import {
  AUTO_HIDDEN_DEFAULTS,
  AUTO_MULTIPLIER_MAX,
  AUTO_MULTIPLIER_MIN,
  AUTO_TRADE_DEFAULTS,
  type AutoAccount,
  type AutoTradeSettings,
} from '@/domain/auto-trade'
import { LOAD_PREDICTION_FIRST, type LoadedPrediction } from '@/domain/prediction'
import { useAuthSession } from '@/hooks/useAuth'
import { useAutoTrade } from '@/hooks/useAutoTrade'
import { useRealTradingConfig } from '@/hooks/useRealTradingConfig'
import { REAL_STAKE_MAX, REAL_STAKE_MIN } from '@/domain/digit-contracts'
import { cn } from '@/lib/cn'
import { PREDICTION_CHANGED_STOP, autoTradeEngine, stopAutoTrade } from '@/providers/bots/auto-trader'
import { REAL_CONNECTION_INACTIVE } from '@/providers/bots/auto-trade-executors'
import type { AccountMode } from '@/types'
import { accountShortName } from '@/lib/branding'
import { safeUserMessage } from '@/lib/safe-user-message'

const AUTO_TAB =
  'flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-bold tracking-wide text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-ink'
const FIELD =
  'h-8 w-full rounded-md border border-line bg-ink-2 px-2 font-mono text-xs text-paper outline-none focus:border-signal focus:ring-2 focus:ring-signal/25 disabled:opacity-60'

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden>
      <path d="M7 4.5v15a1 1 0 0 0 1.52.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5z" />
    </svg>
  )
}

function accountOf(kind: AccountMode): AutoAccount {
  return kind === 'real' ? 'REAL' : 'DEMO'
}

export function AutoTradePanel({
  kind,
  prediction,
  ticketReady,
  baseStake,
  durationTicks,
  blockReason,
  waitingForPrice,
  belowStart,
}: {
  kind: AccountMode
  prediction: LoadedPrediction | null
  ticketReady: boolean
  baseStake: number
  durationTicks: number
  blockReason: string | null
  waitingForPrice: boolean
  belowStart?: ReactNode
}) {
  const account = accountOf(kind)
  const isReal = account === 'REAL'
  const auto = useAutoTrade()
  const { isSignedIn } = useAuthSession()
  const realTrading = useRealTradingConfig(kind)
  const realStakeBounds = {
    min: realTrading.config?.stakeMin ?? REAL_STAKE_MIN,
    max: realTrading.config?.stakeMax ?? REAL_STAKE_MAX,
  }
  const [targetProfit, setTargetProfit] = useState(String(AUTO_TRADE_DEFAULTS.targetProfit))
  const [stopLoss, setStopLoss] = useState(String(AUTO_TRADE_DEFAULTS.stopLoss))
  const [multiplier, setMultiplier] = useState(String(AUTO_TRADE_DEFAULTS.multiplier))
  const [error, setError] = useState<string | null>(null)

  const session = auto.session
  const running = session?.status === 'running'

  useEffect(() => {
    if (prediction) setError(null)
    if (running && prediction?.id !== session.prediction.id) stopAutoTrade(PREDICTION_CHANGED_STOP)
  }, [prediction, running, session?.prediction.id])

  useEffect(() => {
    autoTradeEngine.stopIfNotMode(account, `Switched to ${accountShortName(account === 'REAL' ? 'real' : 'demo')}`)
    setError(null)
  }, [account])
  useEffect(() => {
    if (!running) return
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && session.account === 'REAL') {
        stopAutoTrade(`Stopped because the page was hidden — ${accountShortName('real')} Auto Trade never runs unattended`)
      }
    }
    const onOffline = () => stopAutoTrade('Stopped because the connection was lost')
    const onPageHide = () => stopAutoTrade('Stopped because the page was closed or reloaded')
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('offline', onOffline)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [running, session?.account])
  useEffect(() => {
    if (running && session.account === 'REAL' && !isSignedIn) stopAutoTrade('Signed out')
  }, [running, session?.account, isSignedIn])

  function settings(): AutoTradeSettings {
    const platformMax = isReal ? realStakeBounds.max : AUTO_TRADE_DEFAULTS.maxStake
    return {
      account,
      ...AUTO_HIDDEN_DEFAULTS,
      durationTicks,
      baseStake,
      targetProfit: Number(targetProfit),
      stopLoss: Number(stopLoss),
      multiplier: Number(multiplier),
      maxLossStreak: AUTO_TRADE_DEFAULTS.maxLossStreak,
      maxStake: Math.min(AUTO_TRADE_DEFAULTS.maxStake, platformMax),
    }
  }

  function requestStart() {
    if (!prediction) {
      setError(LOAD_PREDICTION_FIRST)
      return
    }
    const result = autoTradeEngine.start(settings(), account, {
      realConfirmed: isReal,
      prediction,
      realStakeBounds: isReal ? realStakeBounds : undefined,
    })
    setError(result.ok ? null : 'Auto-trade could not start. Please try again.')
  }

  const noPrediction = prediction == null
  const startDisabled = !noPrediction && (!ticketReady || blockReason != null || waitingForPrice)
  const blockText =
    blockReason && /unavailable|Sign in/i.test(blockReason)
      ? REAL_CONNECTION_INACTIVE
      : safeUserMessage(blockReason, REAL_CONNECTION_INACTIVE)
  const showSettings = !isReal || blockReason == null || running
  return (
    <div className="space-y-1.5" data-testid="auto-trade-panel" data-account={account}>
      {running ? (
        <button
          type="button"
          onClick={() => stopAutoTrade()}
          className={cn(AUTO_TAB, 'bg-signal-dim ring-1 ring-signal-light/50 hover:bg-signal-hover active:bg-signal-dim/80')}
          data-testid="auto-trade-stop"
          aria-label="Stop Auto Trade"
        >
          <span className="relative flex h-2.5 w-2.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal-soft opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
          </span>
          STOP AUTO TRADE
        </button>
      ) : isReal && blockReason != null ? (
        <button
          type="button"
          disabled
          title={blockText}
          className="flex h-11 w-full cursor-not-allowed flex-col items-center justify-center rounded-lg border border-signal/25 bg-signal/15 text-signal-soft/70"
          data-testid="auto-trade-disabled"
        >
          <span className="flex items-center gap-1.5 text-sm font-bold">
            <PlayIcon />
            AUTO TRADE
          </span>
          <span className="px-2 text-[10px] text-mist" data-testid="auto-trade-unavailable">
            {blockText}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={requestStart}
          disabled={startDisabled}
          aria-disabled={noPrediction || startDisabled ? true : undefined}
          data-blocked={noPrediction ? 'no-prediction' : undefined}
          className={cn(
            AUTO_TAB,
            'bg-signal-strong shadow-[0_8px_20px_-6px_rgb(59_130_246_/_0.45)] hover:bg-signal-hover active:translate-y-px active:bg-signal-dim disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-signal-strong/40 disabled:text-white/70 disabled:shadow-none',
            noPrediction && 'cursor-not-allowed bg-signal-strong/40 text-white/70 shadow-none hover:bg-signal-strong/40 active:translate-y-0',
          )}
          data-testid="auto-trade-start"
        >
          <PlayIcon />
          AUTO TRADE
        </button>
      )}

      {belowStart}

      {session && (running || session.status === 'stopped') ? (
        <p className="text-xs text-warn" role="alert" data-testid="auto-trade-error">
          {error}
        </p>
      ) : null}

      {showSettings ? (
        <div className="rounded-xl border border-line p-2.5" data-testid="trade-settings">
          <p className="text-[11px] font-medium text-mist">Trade settings</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 lg:grid-cols-3">
            {[
              { label: 'Multiplier ×', value: multiplier, set: setMultiplier, step: '0.1', min: AUTO_MULTIPLIER_MIN, max: AUTO_MULTIPLIER_MAX },
              { label: 'Target Profit $', value: targetProfit, set: setTargetProfit, step: '1', min: 1 },
              { label: 'Stop Loss $', value: stopLoss, set: setStopLoss, step: '1', min: 1 },
            ].map((field) => (
              <label key={field.label} className="block">
                <span className="block text-[10px] text-mist">{field.label}</span>
                <input
                  type="number"
                  value={field.value}
                  step={field.step}
                  min={field.min}
                  max={field.max}
                  disabled={running}
                  onChange={(event) => field.set(event.target.value)}
                  className={FIELD}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
