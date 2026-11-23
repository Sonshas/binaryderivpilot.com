import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Badge, Button, Card, Input, Modal, PageHeader, Skeleton, Stat, Tabs } from '@/components/ui'
import {
  displayedEarnedTotalKes,
  formatEarnedKes,
  nairobiDateKey,
  splitDepositEarnings,
  splitEqualPartners,
  splitEarnedTotalKes,
} from '@/domain/admin-earnings'
import { usdToKesAt, type PeriodSeries, type PeriodSummary } from '@/domain/admin-panel'
import { kesToUsd } from '@/domain/megapay'
import { usdToKes } from '@/domain/withdrawals'
import { formatKes } from '@/features/payments/MoneyPair'
import { formatMoney } from '@/lib/format'
import { useSuperadminUnlock } from '@/hooks/useSuperadminUnlock'
import { readSavedHostFees } from '@/services/admin-fees'
import {
  adminDashboardService,
  type AdminDashboard,
  type DashboardDepositRow,
} from '@/services/admin-dashboard'
import {
  adminPanelService,
  type AdminPanelOverview,
  type PanelAuditRow,
  type PanelUser,
  type PanelUserDetail,
} from '@/services/admin-panel'
import {
  auditActionLabel,
  auditValue,
  filterPanelUsers,
  formatPercent,
  parseBalanceInput,
  parsePercentInput,
  settledPercent,
} from '@/features/admin/super-admin-model'

const DEFAULT_DEPOSIT_RATE = 130

function depositFxRate(): number {
  const rate = readSavedHostFees()?.deposit.kesPerUsd
  return Number.isFinite(rate) && (rate as number) > 0 ? (rate as number) : DEFAULT_DEPOSIT_RATE
}

function depositRowUsd(row: DashboardDepositRow, rate: number): number {
  if (row.amountUsd != null) return row.amountUsd
  if (row.amountKes != null) return kesToUsd(row.amountKes, rate)
  return 0
}

const PAGE_SIZE = 100

function kes(value: number | null): string {
  if (value == null) return 'KES —'
  return `KES ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function when(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
}

const th = 'px-3 py-2 font-semibold'
const td = 'px-3 py-2'
const tableHead = 'border-b border-line bg-ink-2/80 text-[11px] font-semibold uppercase tracking-wider text-mist'

function Section({ title, subtitle, children, testId }: { title: string; subtitle?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <div>
        <h2 className="font-display text-lg font-semibold text-paper">{title}</h2>
        {subtitle ? <p className="text-sm text-mist">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  )
}

function SuperadminUnlockGate({
  onUnlock,
}: {
  onUnlock: (password: string) => boolean
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (onUnlock(password)) {
      setError(null)
      setPassword('')
      return
    }
    setError('Incorrect password.')
  }

  return (
    <div className="space-y-8" data-testid="superadmin-unlock-gate">
      <PageHeader
        title="Superadmin"
        subtitle="Enter the superadmin password to unlock the full panel and hidden earnings for this session."
      />
      <Card className="max-w-md space-y-4">
        <form className="space-y-4" onSubmit={submit}>
          <Input
            label="Superadmin password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            data-testid="superadmin-unlock-password"
          />
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" data-testid="superadmin-unlock-submit">
            Unlock
          </Button>
        </form>
      </Card>
    </div>
  )
}

/**
 * Superadmin console. Rendered only after RequireStaff + RequireSuperadmin; every read and write is
 * re-checked server-side. Only virtual Demo balances and the Demo win rate are editable.
 * Client password unlock is required before the panel (and hidden earnings elsewhere) open.
 */
export function SuperAdminPanel() {
  const { unlocked, unlock, lock, canAttempt } = useSuperadminUnlock()
  const [data, setData] = useState<AdminPanelOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)
  const timer = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await adminPanelService.overview()
    setLoading(false)
    if (result.ok) {
      setData(result.data)
      setError(null)
    } else {
      setError(result.error === 'Forbidden' ? 'This panel is limited to the superadmin account.' : result.error)
    }
  }, [])

  useEffect(() => {
    if (!unlocked) {
      setData(null)
      return
    }
    void load()
    const unsubscribe = adminPanelService.subscribe(() => {
      setLive(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void load(), 1500)
    })
    return () => {
      unsubscribe()
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [load, unlocked])

  if (!canAttempt) {
    return (
      <div data-testid="superadmin-denied">
        <PageHeader title="Forbidden" />
        <Alert tone="danger">This section is limited to the superadmin account.</Alert>
      </div>
    )
  }

  if (!unlocked) {
    return <SuperadminUnlockGate onUnlock={unlock} />
  }

  return (
    <div className="space-y-8" data-testid="super-admin-panel">
      <PageHeader
        title="Superadmin"
        subtitle="Deposits, sign-ups, users, Demo balances and the Demo win rate. Demo values are virtual and never touch real wallets, trades or withdrawals."
        actions={
          <div className="flex items-center gap-2">
            {live ? <Badge tone="call">Live</Badge> : null}
            <Button type="button" variant="secondary" onClick={() => lock()} data-testid="superadmin-lock">
              Lock
            </Button>
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading} data-testid="admin-panel-refresh">
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {loading && !data ? <Skeleton className="h-40" /> : null}
      <RetainedShareSection />
      {data ? (
        <>
          <DepositsSection data={data} />
          <SignupsSection data={data} />
          <WinRateSection globalRate={data.globalWinRate} onSaved={load} />
          <UsersSection data={data} onChanged={load} />
          <WithdrawalsSection data={data} />
          <AuditSection rows={data.audit} />
          <p className="text-xs text-mist">Generated {when(data.generatedAt)}</p>
        </>
      ) : null}
    </div>
  )
}

/** Unlocked Sonshas only: retained card, carved payments, and full totals. */
function RetainedShareSection() {
  const [dash, setDash] = useState<AdminDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const rate = depositFxRate()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void adminDashboardService.loadRetained().then((result) => {
      if (cancelled) return
      setLoading(false)
      if (result.ok) {
        setDash(result.data)
        setError(null)
      } else {
        setDash(null)
        setError(result.error === 'Forbidden' ? 'Could not load retained-share deposits.' : result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const amountOf = useCallback((row: DashboardDepositRow) => depositRowUsd(row, rate), [rate])
  const atOf = useCallback((row: DashboardDepositRow) => row.creditedAt ?? row.createdAt ?? '', [])

  const fullUsd = useMemo(() => {
    if (!dash) return 0
    return Math.round(
      (dash.collected.reduce((sum, row) => sum + amountOf(row), 0) + Number.EPSILON) * 100,
    ) / 100
  }, [dash, amountOf])

  const split = useMemo(() => splitDepositEarnings(fullUsd), [fullUsd])

  const hiddenRows = useMemo(() => dash?.hidden ?? [], [dash])

  const hiddenPaymentsUsd = useMemo(
    () => Math.round((hiddenRows.reduce((sum, row) => sum + amountOf(row), 0) + Number.EPSILON) * 100) / 100,
    [hiddenRows, amountOf],
  )
  const today = nairobiDateKey(new Date().toISOString()) ?? '1970-01-01'
  const todayRows = useMemo(() => {
    if (!dash) return []
    return dash.collected.filter((row) => nairobiDateKey(atOf(row)) === today)
  }, [dash, atOf, today])
  const todayUsd = useMemo(
    () => Math.round((todayRows.reduce((sum, row) => sum + amountOf(row), 0) + Number.EPSILON) * 100) / 100,
    [todayRows, amountOf],
  )
  const todayHidden = useMemo(
    () => (dash?.hidden ?? []).filter((row) => nairobiDateKey(atOf(row)) === today),
    [dash, atOf, today],
  )
  const todayHiddenUsd = useMemo(
    () => Math.round((todayHidden.reduce((sum, row) => sum + amountOf(row), 0) + Number.EPSILON) * 100) / 100,
    [todayHidden, amountOf],
  )
  const todaySplit = useMemo(
    () => splitEqualPartners(Math.max(0, todayUsd - todayHiddenUsd)),
    [todayUsd, todayHiddenUsd],
  )
  const earnedSplit = useMemo(
    () => splitEarnedTotalKes(displayedEarnedTotalKes(dash?.totals.earnedTotalKes)),
    [dash?.totals.earnedTotalKes],
  )

  return (
    <Section
      title="Retained share"
      subtitle="Visible only while Superadmin is unlocked. Today's retained cut, its payments, and the lifetime retained amount stay off admin dashboards."
      testId="superadmin-retained-share"
    >
      {loading && !dash ? <Skeleton className="h-28" /> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {dash ? (
        <>
          <div className="space-y-3" data-testid="superadmin-today-cut">
            <h3 className="font-display text-base font-semibold text-paper">Today's retained cut</h3>
            <p className="text-sm text-mist">
              Nairobi day {today}. This cut of today's completed payments stays off admin dashboards.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Today's earnings"
                value={formatMoney(todayUsd)}
                subValue={formatKes(usdToKes(todayUsd, rate))}
                hint={`${todayRows.length} completed payment${todayRows.length === 1 ? '' : 's'}`}
                tone="live"
              />
              <Card data-testid="superadmin-today-hidden">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-mist">Today's retained cut</p>
                <h3 className="mt-1 font-display text-base font-semibold text-paper">sonshasopunga</h3>
                <p className="text-xs text-mist">Hidden from admins</p>
                <p className="mt-3 font-mono text-xl font-semibold text-live">{formatMoney(todayHiddenUsd)}</p>
                <p className="mt-1 text-xs text-mist">{formatKes(usdToKes(todayHiddenUsd, rate))}</p>
                <p className="mt-1 text-xs text-mist">
                  {formatMoney(todayHiddenUsd)} across {todayHidden.length} hidden payment{todayHidden.length === 1 ? '' : 's'}
                </p>
              </Card>
              {todaySplit.shares.map((share) => (
                <Stat
                  key={share.key}
                  label={`${share.key} 50%`}
                  value={formatMoney(share.netUsd)}
                  subValue={formatKes(usdToKes(share.netUsd, rate))}
                  hint="Earned after the 5% receivers share"
                />
              ))}
            </div>
            {todayHidden.length === 0 ? (
              <p className="text-sm text-mist" data-testid="superadmin-today-hidden-empty">
                No payments have been set aside on today's retained cut yet.
              </p>
            ) : (
              <HiddenPaymentsTable rows={todayHidden} amountOf={amountOf} rate={rate} testId="superadmin-today-hidden-row" />
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Recorded retained amount"
              value={formatEarnedKes(earnedSplit.hiddenKes)}
              hint="Kept off admin dashboards"
              tone="live"
            />
        <Stat
          label="Total earned"
          value={formatEarnedKes(displayedEarnedTotalKes(dash.totals.earnedTotalKes))}
          hint="Total earned"
          tone="live"
        />
            <Card data-testid="superadmin-share-hidden">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-mist">Retained</p>
              <h3 className="mt-1 font-display text-base font-semibold text-paper">sonshasopunga</h3>
              <p className="text-xs text-mist">Hidden share (not shown to rulli)</p>
              <p className="mt-3 font-mono text-xl font-semibold text-live">{formatMoney(hiddenPaymentsUsd)}</p>
              <p className="mt-1 text-xs text-mist">{formatKes(usdToKes(hiddenPaymentsUsd, rate))}</p>
            </Card>
            <Stat
              label="Shared pool"
              value={formatMoney(split.sharedUsd)}
              subValue={formatKes(usdToKes(split.sharedUsd, rate))}
              hint="Split 50% and 50%"
            />
            <Stat
              label="Carved payments"
              value={String(hiddenRows.length)}
              hint={`${formatMoney(hiddenPaymentsUsd)} charged on daily incoming payments`}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {split.shares.map((share) => (
              <Card key={share.key} data-testid={`superadmin-share-${share.key}`}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-mist">50%</p>
                <h3 className="mt-1 font-display text-base font-semibold text-paper">{share.key}</h3>
                <p className="text-xs text-mist">{share.email}</p>
                <p className="mt-3 font-mono text-xl font-semibold text-live">{formatMoney(share.netUsd)}</p>
                <p className="mt-1 text-xs text-paper">Earned after 5% charge</p>
                <p className="text-xs text-mist">{formatKes(usdToKes(share.netUsd, rate))}</p>
                <p className="mt-2 text-xs text-mist">50% split {formatMoney(share.grossUsd)}</p>
                <p className="text-xs text-mist">Receivers share 5% {formatMoney(share.chargeUsd)}</p>
              </Card>
            ))}
          </div>
          <div className="space-y-2" data-testid="superadmin-hidden-payments">
            <h3 className="font-display text-base font-semibold text-paper">Hidden payments (carved out)</h3>
            <p className="text-sm text-mist">
              From 22 Nov 2026, a portion of each day's payments is hidden here and stays hidden after that day ends. Days before that are shown in full to admins.
            </p>
            {hiddenRows.length === 0 ? (
              <p className="text-sm text-mist">No carved payments in the current deposit list.</p>
            ) : (
              <HiddenPaymentsTable rows={hiddenRows} amountOf={amountOf} rate={rate} testId="superadmin-hidden-payment-row" />
            )}
          </div>
        </>
      ) : null}
    </Section>
  )
}

function HiddenPaymentsTable({
  rows,
  amountOf,
  rate,
  testId,
}: {
  rows: DashboardDepositRow[]
  amountOf: (row: DashboardDepositRow) => number
  rate: number
  testId: string
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className={tableHead}>
          <tr>
            <th className={th}>Who paid</th>
            <th className={th}>Payment</th>
            <th className={th}>Amount</th>
            <th className={th}>Credited</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line/60 last:border-0" data-testid={testId}>
              <td className={td}>{row.userEmail ?? 'No email on file'}</td>
              <td className={td}>{row.payment || 'Deposit'}</td>
              <td className={`${td} font-mono`}>
                <span className="block">{formatMoney(amountOf(row))}</span>
                <span className="mt-0.5 block text-xs text-mist">
                  {formatKes(row.amountKes != null ? row.amountKes : usdToKes(amountOf(row), rate))}
                </span>
              </td>
              <td className={`${td} text-mist`}>{when(row.creditedAt ?? row.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DepositsSection({ data }: { data: AdminPanelOverview }) {
  const rate = data.kesPerUsd
  const s = data.deposits.summary
  const card = (label: string, total: PeriodSummary['total']) => (
    <Stat label={label} value={formatMoney(total.usd)} hint={`${kes(usdToKesAt(total.usd, rate))} · ${total.count} deposit${total.count === 1 ? '' : 's'}`} tone="live" />
  )
  return (
    <Section
      title="Deposits"
      subtitle={`Completed real M-Pesa deposits. KES at ${rate ? `${rate} KES / USD` : 'an unavailable rate'} (${data.rateSource}). Nairobi calendar days; weeks start Monday.`}
      testId="admin-panel-deposits"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {card('All time', s.total)}
        {card('Today', s.today)}
        {card('Yesterday', s.yesterday)}
        {card('This week', s.week)}
        {card('This month', s.month)}
      </div>
      <p className="text-xs text-mist">
        KES actually recorded on these deposits: {kes(data.deposits.recordedKesTotal)}. Pending / failed attempts not counted: {data.deposits.notCollectedCount}.
      </p>
      <SeriesChart series={data.deposits.series} metric="usd" rate={rate} />
    </Section>
  )
}

function SignupsSection({ data }: { data: AdminPanelOverview }) {
  const s = data.signups.summary
  return (
    <Section title="Users who joined" subtitle="Sign-ups (Nairobi calendar days; weeks start Monday)." testId="admin-panel-signups">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total users" value={String(s.total.count)} />
        <Stat label="Joined today" value={String(s.today.count)} />
        <Stat label="Joined this week" value={String(s.week.count)} />
        <Stat label="Joined this month" value={String(s.month.count)} />
      </div>
      <SeriesChart series={data.signups.series} metric="count" rate={null} />
    </Section>
  )
}

function SeriesChart({ series, metric, rate }: { series: PeriodSeries; metric: 'usd' | 'count'; rate: number | null }) {
  const [range, setRange] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const points = series[range]
  const max = Math.max(1, ...points.map((p) => (metric === 'usd' ? p.usd : p.count)))
  return (
    <Card>
      <Tabs
        items={[
          { id: 'daily', label: 'Per day' },
          { id: 'weekly', label: 'Per week' },
          { id: 'monthly', label: 'Per month' },
        ]}
        value={range}
        onChange={(id) => setRange(id as typeof range)}
      />
      <div className="mt-4 flex h-36 items-end gap-1" aria-label={`${metric} per ${range}`}>
        {points.map((p) => {
          const value = metric === 'usd' ? p.usd : p.count
          const title = metric === 'usd' ? `${p.label}: ${formatMoney(p.usd)} · ${kes(usdToKesAt(p.usd, rate))} · ${p.count}` : `${p.label}: ${p.count}`
          return (
            <div key={p.start} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={title}>
              <div className="w-full rounded-t bg-signal/70" style={{ height: `${Math.max(value > 0 ? 4 : 1, (value / max) * 120)}px` }} />
              <span className="w-full truncate text-center text-[10px] text-mist">{p.label}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-3 max-h-48 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className={tableHead}>
            <tr>
              <th className={th}>Period</th>
              {metric === 'usd' ? (
                <>
                  <th className={th}>USD</th>
                  <th className={th}>KES</th>
                </>
              ) : null}
              <th className={th}>Count</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.start} className="border-b border-line/60 last:border-0">
                <td className={td}>{p.label}</td>
                {metric === 'usd' ? (
                  <>
                    <td className={`${td} font-mono`}>{formatMoney(p.usd)}</td>
                    <td className={`${td} font-mono`}>{kes(usdToKesAt(p.usd, rate))}</td>
                  </>
                ) : null}
                <td className={`${td} font-mono`}>{p.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function WinRateSection({ globalRate, onSaved }: { globalRate: number; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(String(globalRate))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'signal' | 'danger'; text: string } | null>(null)

  useEffect(() => setValue(String(globalRate)), [globalRate])

  async function save() {
    const percent = parsePercentInput(value)
    if (percent == null) {
      setMessage({ tone: 'danger', text: 'Enter a win rate between 0 and 100.' })
      return
    }
    setBusy(true)
    const result = await adminPanelService.setGlobalWinRate(percent, reason)
    setBusy(false)
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.error })
      return
    }
    setMessage({ tone: 'signal', text: `Global Demo win rate set to ${formatPercent(result.data)}. Signed-in users pick it up within seconds.` })
    setReason('')
    await onSaved()
  }

  return (
    <Section
      title="Demo win rate"
      subtitle="Share of Demo trades (manual, scanner and Auto Trade) that win. Users with an override below ignore the global rate. Real-account win rates stay on Trade settings / Users and are not changed here."
      testId="admin-panel-win-rate"
    >
      <Card>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <Input label="Global Demo win rate (%)" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} data-testid="global-win-rate-input" />
          <Input label="Reason (audit log)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          <Button type="button" onClick={() => void save()} disabled={busy} data-testid="global-win-rate-save">
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-mist">
          Current: {formatPercent(globalRate)} (settles as {settledPercent(globalRate)}% — outcomes use whole winning digits 0–9).
        </p>
        {message ? <Alert className="mt-3" tone={message.tone}>{message.text}</Alert> : null}
      </Card>
    </Section>
  )
}

function UsersSection({ data, onChanged }: { data: AdminPanelOverview; onChanged: () => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const users = useMemo(() => filterPanelUsers(data.users, query), [data.users, query])
  const shown = users.slice(0, limit)
  return (
    <Section
      title="Users"
      subtitle="Demo balance = the last value the user's browser reported. Edits reach the user's Demo wallet live while they are signed in, otherwise on their next visit. Real wallet is read-only here."
      testId="admin-panel-users"
    >
      <Input
        placeholder="Search by email, user id, or role"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setLimit(PAGE_SIZE)
        }}
        data-testid="admin-user-search"
      />
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className={tableHead}>
            <tr>
              <th className={th}>Email</th>
              <th className={th}>Joined</th>
              <th className={th}>Demo</th>
              <th className={th}>Real wallet</th>
              <th className={th}>Demo win rate</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td className={`${td} text-mist`} colSpan={6}>
                  No users match.
                </td>
              </tr>
            ) : null}
            {shown.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                open={openId === u.id}
                onToggle={() => setOpenId(openId === u.id ? null : u.id)}
                onChanged={onChanged}
                startingBalance={data.startingBalance}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-mist">
          Showing {shown.length} of {users.length} matching ({data.users.length} users). “Not reported” means the user has not opened the app since
          this panel went live; their Demo wallet starts at {formatMoney(data.startingBalance)}.
        </p>
        {users.length > shown.length ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            Show more
          </Button>
        ) : null}
      </div>
    </Section>
  )
}

function UserRow({
  user,
  open,
  onToggle,
  onChanged,
  startingBalance,
}: {
  user: PanelUser
  open: boolean
  onToggle: () => void
  onChanged: () => Promise<void>
  startingBalance: number
}) {
  return (
    <>
      <tr className="border-b border-line/80" data-testid="admin-panel-user-row">
        <td className={`${td} text-paper`}>
          {user.email ?? 'No email'}
          {user.role !== 'trader' ? (
            <Badge className="ml-2" tone="signal">
              {user.role}
            </Badge>
          ) : null}
          {user.isVip ? (
            <Badge className="ml-2" tone="amber">
              VIP
            </Badge>
          ) : null}
        </td>
        <td className={`${td} text-mist`}>{when(user.signedUpAt)}</td>
        <td className={`${td} font-mono`}>
          {user.demoBalance == null ? <span className="text-mist">Not reported</span> : formatMoney(user.demoBalance)}
          {user.demoPendingAdmin ? (
            <Badge className="ml-2" tone="warn">
              Admin set
            </Badge>
          ) : null}
        </td>
        <td className={`${td} font-mono`}>{formatMoney(user.realBalance, user.realCurrency)}</td>
        <td className={td}>
          <span className="font-mono">{formatPercent(user.effectiveWinRate)}</span>{' '}
          <Badge tone={user.winRateOverride == null ? 'mist' : 'amber'}>{user.winRateOverride == null ? 'global' : 'override'}</Badge>
        </td>
        <td className={td}>
          <Button type="button" size="sm" variant="secondary" onClick={onToggle} data-testid="admin-user-manage">
            {open ? 'Close' : 'Manage'}
          </Button>
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-line/80 bg-ink-2/40">
          <td colSpan={6} className="p-3">
            <UserManager user={user} onChanged={onChanged} startingBalance={startingBalance} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

function UserManager({ user, onChanged, startingBalance }: { user: PanelUser; onChanged: () => Promise<void>; startingBalance: number }) {
  const [demo, setDemo] = useState(String(user.demoBalance ?? startingBalance))
  const [rate, setRate] = useState(user.winRateOverride == null ? '' : String(user.winRateOverride))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'signal' | 'danger'; text: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [detail, setDetail] = useState<PanelUserDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const loadDetail = useCallback(async () => {
    const result = await adminPanelService.userDetail(user.id)
    if (result.ok) setDetail(result.data)
    else setDetailError(result.error)
  }, [user.id])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  useEffect(() => setDemo(String(user.demoBalance ?? startingBalance)), [user.demoBalance, startingBalance])

  async function run(label: string, action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setBusy(label)
    const result = await action()
    setBusy(null)
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.error })
      return
    }
    setMessage({ tone: 'signal', text: success })
    setReason('')
    await Promise.all([onChanged(), loadDetail()])
  }

  function saveBalance(value: number | null, label: string) {
    if (value == null) {
      setMessage({ tone: 'danger', text: 'Enter a balance between 0 and 1,000,000,000.' })
      return
    }
    void run(label, () => adminPanelService.setDemoBalance(user.id, value, reason), `Demo balance set to ${formatMoney(value)}. The user's Demo wallet updates live.`)
  }

  function saveRate(clear: boolean) {
    const value = clear ? null : parsePercentInput(rate)
    if (!clear && value == null) {
      setMessage({ tone: 'danger', text: 'Enter a win rate between 0 and 100, or use the global rate.' })
      return
    }
    void run(
      'rate',
      () => adminPanelService.setUserWinRate(user.id, value, reason),
      clear ? 'Override removed: this user now follows the global Demo win rate.' : `Demo win rate override set to ${formatPercent(value)}.`,
    )
    if (clear) setRate('')
  }

  return (
    <div className="space-y-4" data-testid="admin-user-manager">
      <p className="text-xs text-mist">
        User id <span className="font-mono">{user.id}</span> · status {user.accountStatus} · Demo last reported {when(user.demoReportedAt)}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <p className="text-sm font-semibold text-demo">Demo balance (virtual, not withdrawable)</p>
          <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
            <Input label="Demo balance (USD)" inputMode="decimal" value={demo} onChange={(e) => setDemo(e.target.value)} data-testid="admin-demo-balance-input" />
            <Button type="button" onClick={() => saveBalance(parseBalanceInput(demo), 'demo')} disabled={busy != null} data-testid="admin-demo-balance-save">
              {busy === 'demo' ? 'Saving…' : 'Set'}
            </Button>
          </div>
          <Button className="mt-3" type="button" variant="danger" size="sm" onClick={() => setConfirmReset(true)} disabled={busy != null}>
            Reset to {formatMoney(startingBalance)}
          </Button>
        </Card>
        <Card>
          <p className="text-sm font-semibold text-amber">Demo win rate override</p>
          <p className="mt-1 text-xs text-mist">
            Effective now: {formatPercent(user.effectiveWinRate)} ({user.winRateOverride == null ? 'global' : 'override'})
          </p>
          <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
            <Input label="Override (%)" placeholder="Uses global" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} data-testid="admin-user-win-rate-input" />
            <Button type="button" onClick={() => saveRate(false)} disabled={busy != null} data-testid="admin-user-win-rate-save">
              {busy === 'rate' ? 'Saving…' : 'Set'}
            </Button>
          </div>
          <Button className="mt-3" type="button" variant="secondary" size="sm" onClick={() => saveRate(true)} disabled={busy != null || user.winRateOverride == null}>
            Use global
          </Button>
        </Card>
      </div>
      <Input label="Reason for the next change (saved in the audit log)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      {detailError ? <Alert tone="danger">{detailError}</Alert> : null}
      {!detail && !detailError ? <Skeleton className="h-16" /> : null}
      {detail ? <UserDetailTables detail={detail} /> : null}

      <Modal open={confirmReset} title="Reset Demo balance" onClose={() => setConfirmReset(false)}>
        <p className="text-sm text-mist">
          Set {user.email ?? 'this user'}'s Demo balance to {formatMoney(startingBalance)}? This is logged.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setConfirmReset(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={busy != null}
            onClick={() => {
              setConfirmReset(false)
              saveBalance(startingBalance, 'reset')
            }}
          >
            Reset balance
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function UserDetailTables({ detail }: { detail: PanelUserDetail }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-semibold text-paper">Recent real trades</p>
        {detail.realTrades.length === 0 ? (
          <p className="text-sm text-mist">No real trades.</p>
        ) : (
          <div className="max-h-72 overflow-auto rounded-xl border border-line">
            <table className="w-full text-left text-xs">
              <thead className={tableHead}>
                <tr>
                  <th className={th}>When</th>
                  <th className={th}>Market</th>
                  <th className={th}>Contract</th>
                  <th className={th}>Stake</th>
                  <th className={th}>Status</th>
                  <th className={th}>P/L</th>
                </tr>
              </thead>
              <tbody>
                {detail.realTrades.map((t) => {
                  const pl = Number(t.profit_loss)
                  return (
                    <tr key={String(t.id)} className="border-b border-line/60 last:border-0">
                      <td className={td}>{when(typeof t.created_at === 'string' ? t.created_at : null)}</td>
                      <td className={td}>{String(t.symbol ?? '—')}</td>
                      <td className={td}>
                        {String(t.contract_type ?? '')}
                        {t.contract_option ? `/${String(t.contract_option)}` : ''}
                      </td>
                      <td className={`${td} font-mono`}>{formatMoney(Number(t.stake))}</td>
                      <td className={td}>{String(t.status ?? '')}</td>
                      <td className={`${td} font-mono ${pl >= 0 ? 'text-call' : 'text-put'}`}>{Number.isFinite(pl) ? formatMoney(pl) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1 text-xs text-mist">Demo trades run in the user's browser and are not stored on the server.</p>
      </div>
      {detail.withdrawals.length > 0 ? (
        <p className="text-xs text-mist">
          Real withdrawals: {detail.withdrawals.map((w) => `${String(w.status)} ${formatMoney(Number(w.amount))}`).join(' · ')}
        </p>
      ) : null}
      {detail.adminEdits.length > 0 ? <AuditTable rows={detail.adminEdits} /> : null}
    </div>
  )
}

function WithdrawalsSection({ data }: { data: AdminPanelOverview }) {
  const statuses = Object.entries(data.withdrawals.byStatus).sort((a, b) => b[1].count - a[1].count)
  return (
    <Section title="Withdrawals" subtitle="Real-wallet withdrawals, read-only. Approvals and payouts stay on the Withdrawals page." testId="admin-panel-withdrawals">
      <div className="flex flex-wrap items-center gap-2">
        {statuses.length === 0 ? <p className="text-sm text-mist">No withdrawals recorded.</p> : null}
        {statuses.map(([status, entry]) => (
          <Badge key={status} tone={status === 'COMPLETED' ? 'call' : status === 'FAILED' ? 'danger' : 'warn'}>
            {status}: {entry.count} · {formatMoney(entry.usd)}
          </Badge>
        ))}
        <Link to="/admin/withdrawals" className="ml-auto text-sm text-signal">
          Open withdrawals →
        </Link>
      </div>
      {data.withdrawals.recent.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className={tableHead}>
              <tr>
                <th className={th}>User</th>
                <th className={th}>USD</th>
                <th className={th}>KES</th>
                <th className={th}>Status</th>
                <th className={th}>Reference</th>
                <th className={th}>Requested</th>
              </tr>
            </thead>
            <tbody>
              {data.withdrawals.recent.map((w) => (
                <tr key={w.id} className="border-b border-line/80 last:border-0">
                  <td className={td}>{w.userEmail ?? '—'}</td>
                  <td className={`${td} font-mono`}>{formatMoney(w.amountUsd)}</td>
                  <td className={`${td} font-mono`}>{kes(w.amountKes)}</td>
                  <td className={td}>{w.status}</td>
                  <td className={`${td} font-mono`}>{w.reference ?? '—'}</td>
                  <td className={`${td} text-mist`}>{when(w.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Section>
  )
}

function AuditTable({ rows }: { rows: PanelAuditRow[] }) {
  return (
    <div className="max-h-96 overflow-auto rounded-xl border border-line">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className={tableHead}>
          <tr>
            <th className={th}>When</th>
            <th className={th}>Admin</th>
            <th className={th}>Action</th>
            <th className={th}>Target</th>
            <th className={th}>Old → New</th>
            <th className={th}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line/80 last:border-0" data-testid="admin-audit-row">
              <td className={`${td} text-mist`}>{when(row.createdAt)}</td>
              <td className={td}>{row.adminEmail ?? '—'}</td>
              <td className={td}>{auditActionLabel(row.action)}</td>
              <td className={td}>{row.targetEmail ?? (row.targetUserId ? row.targetUserId.slice(0, 8) : 'Everyone')}</td>
              <td className={`${td} font-mono`}>
                {auditValue(row, 'old')} → {auditValue(row, 'new')}
              </td>
              <td className={`${td} text-mist`}>{row.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AuditSection({ rows }: { rows: PanelAuditRow[] }) {
  return (
    <Section title="Audit log" subtitle="Every Demo balance and Demo win-rate change made in this panel (also listed on Audit log)." testId="admin-panel-audit">
      {rows.length === 0 ? <p className="text-sm text-mist">No superadmin changes yet.</p> : <AuditTable rows={rows} />}
    </Section>
  )
}
