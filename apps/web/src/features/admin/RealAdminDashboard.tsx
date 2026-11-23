import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Input, PageHeader, Skeleton, Stat } from '@/components/ui'
import {
  nairobiDateKey,
  shiftDateKey,
  displayedEarnedTotalKes,
  formatEarnedKes,
  splitAdminVisibleKes,
  splitEqualPartners,
  weekStartKey,
  type DepositEarningsSplit,
} from '@/domain/admin-earnings'
import { resolveUserPeriodCounts } from '@/domain/admin-user-periods'
import { useAuthSession } from '@/hooks/useAuth'
import { kesToUsd } from '@/domain/megapay'
import { usdToKes } from '@/domain/withdrawals'
import { formatKes } from '@/features/payments/MoneyPair'
import { formatMoney } from '@/lib/format'
import { readSavedHostFees } from '@/services/admin-fees'
import {
  adminDashboardService,
  type AdminDashboard,
  type DashboardDepositRow,
} from '@/services/admin-dashboard'

const DEFAULT_DEPOSIT_RATE = 130

function depositRate(): number {
  const rate = readSavedHostFees()?.deposit.kesPerUsd
  return Number.isFinite(rate) && (rate as number) > 0 ? (rate as number) : DEFAULT_DEPOSIT_RATE
}

function usdLine(usd: number | null, kes: number | null, rate: number): string {
  if (usd != null) return formatMoney(usd)
  if (kes == null) return '—'
  return formatMoney(kesToUsd(kes, rate))
}

function kesLine(usd: number | null, kes: number | null, rate: number): string | null {
  if (kes != null && Number.isFinite(kes)) return formatKes(kes)
  if (usd != null && Number.isFinite(usd)) return formatKes(usdToKes(usd, rate))
  return null
}

function when(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
}

function statusTone(status: string): 'warn' | 'signal' | 'call' | 'danger' | 'mist' {
  if (status === 'COMPLETED') return 'call'
  if (status === 'FAILED') return 'danger'
  if (status === 'CANCELLED') return 'mist'
  if (status === 'PROCESSING') return 'signal'
  return 'warn'
}

function payer(row: DashboardDepositRow): string {
  return row.userEmail ?? 'No email on file'
}

function depositUsd(row: DashboardDepositRow, rate = depositRate()): number {
  if (row.amountUsd != null) return row.amountUsd
  if (row.amountKes != null) return kesToUsd(row.amountKes, rate)
  return 0
}

/** Amounts on this dashboard are already the admin-visible payments. */
function adminShownAmounts(rows: DashboardDepositRow[], rate: number): Map<string, number> {
  const shown = new Map<string, number>()
  for (const row of rows) shown.set(row.id, depositUsd(row, rate))
  return shown
}

function AdminShareStrip({
  split,
  rate,
  testId = 'admin-dashboard-shares',
  shareTestIdPrefix = 'admin-dashboard-share',
}: {
  split: DepositEarningsSplit
  rate: number
  testId?: string
  shareTestIdPrefix?: string
}) {
  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="grid gap-3 md:grid-cols-2">
        {split.shares.map((share) => (
          <Card key={share.key} data-testid={`${shareTestIdPrefix}-${share.key}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-mist">50%</p>
            <h3 className="font-display text-base font-semibold text-paper">{share.key}</h3>
            <p className="text-xs text-mist">{share.email}</p>
            <p className="mt-3 font-mono text-xl font-semibold text-live">{formatMoney(share.netUsd)}</p>
            <p className="mt-1 text-xs text-paper">Earned after 5% charge</p>
            <p className="text-xs text-mist">{formatKes(usdToKes(share.netUsd, rate))}</p>
            <p className="mt-2 text-xs text-mist">50% split {formatMoney(share.grossUsd)}</p>
            <p className="text-xs text-mist">Receivers share 5% {formatMoney(share.chargeUsd)}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function RealAdminDashboard() {
  const { isSignedIn } = useAuthSession()
  const [data, setData] = useState<AdminDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const rate = depositRate()
  const shownAmounts = useMemo(
    () => adminShownAmounts(data?.collected ?? [], rate),
    [data?.collected, rate],
  )
  const viewerCollected = useMemo(
    () => data?.collected ?? [],
    [data?.collected],
  )
  const earnedKes = displayedEarnedTotalKes(data?.totals.earnedTotalKes)

  const load = useCallback(async () => {
    if (!isSignedIn) return
    setLoading(true)
    try {
      const result = await adminDashboardService.load()
      if (result.ok) {
        setData(result.data)
        setError(null)
      } else {
        setData(null)
        setError(result.error === 'Forbidden' ? 'This page is limited to admin, superadmin, and finance accounts.' : result.error)
      }
    } catch (err) {
      setData(null)
      setError(err instanceof Error && err.message ? err.message : 'Could not load the dashboard.')
    } finally {
      setLoading(false)
    }
  }, [isSignedIn])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-8" data-testid="admin-dashboard">
      <PageHeader
        title="Dashboard"
        subtitle="Successful deposits and service payments from the deposits list. Use Daily deposits to inspect any Nairobi calendar day."
        actions={
          isSignedIn ? (
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          ) : null
        }
      />

      {!isSignedIn ? (
        <Alert tone="mist">Sign in with an admin account to see users and money collected.</Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {isSignedIn && loading && !data ? <Skeleton className="h-28" /> : null}

      {data ? (
        <>
          <DashboardPeriods
            data={data}
            lifetimeKes={earnedKes}
            visibleEarnedKes={earnedKes}
            shownAmounts={shownAmounts}
          />
          <DailyDepositsPanel
            rows={data.collected}
            shownAmounts={shownAmounts}
            rate={rate}
          />

          <section className="space-y-3" data-testid="admin-dashboard-collected">
            <h2 className="font-display text-lg font-semibold text-paper">Money collected</h2>
            <p className="text-sm text-mist">
              {`Total earned ${formatEarnedKes(earnedKes)}`}
            </p>
            {viewerCollected.length === 0 ? (
              <p className="text-sm text-mist">No credited M-Pesa deposits.</p>
            ) : (
              <DepositTable rows={viewerCollected} rate={rate} shownAmounts={shownAmounts} />
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}

function formatDayLabel(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12))
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'UTC',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function DashboardPeriods({
  data,
  lifetimeKes,
  visibleEarnedKes,
  shownAmounts,
}: {
  data: AdminDashboard
  lifetimeKes: number
  visibleEarnedKes: number
  shownAmounts: Map<string, number>
}) {
  const rate = depositRate()
  const today = nairobiDateKey(new Date().toISOString()) ?? '1970-01-01'
  const yesterday = shiftDateKey(today, -1)
  const weekStart = weekStartKey(today)
  const monthStart = `${today.slice(0, 8)}01`
  const earnedSplit = splitAdminVisibleKes(lifetimeKes)
  const atOf = (row: DashboardDepositRow) => row.creditedAt ?? row.createdAt ?? ''
  const sumShown = (rows: DashboardDepositRow[]) =>
    Math.round(
      (rows.reduce((sum, row) => sum + (shownAmounts.get(row.id) ?? 0), 0) + Number.EPSILON) * 100,
    ) / 100
  const inDay = (day: string) => data.collected.filter((row) => nairobiDateKey(atOf(row)) === day)
  const inSpan = (start: string) =>
    data.collected.filter((row) => {
      const key = nairobiDateKey(atOf(row))
      return key != null && key >= start && key <= today && shownAmounts.has(row.id)
    })
  const yesterdayUsd = sumShown(inDay(yesterday).filter((row) => shownAmounts.has(row.id)))
  const yesterdaySplit = splitEqualPartners(yesterdayUsd)
  const lifetimeUsd = kesToUsd(visibleEarnedKes, rate)
  const money = [
    {
      label: 'Total money yesterday',
      value: yesterdayUsd,
      kes: usdToKes(yesterdayUsd, rate),
      hint: `Nairobi day ${yesterday}`,
    },
    {
      label: 'Total money today',
      value: sumShown(inDay(today).filter((row) => shownAmounts.has(row.id))),
      kes: null as number | null,
      hint: 'Since midnight',
    },
    {
      label: 'Total money this week',
      value: sumShown(inSpan(weekStart)),
      kes: null as number | null,
      hint: 'Since Monday',
    },
    {
      label: 'Total money this month',
      value: sumShown(inSpan(monthStart)),
      kes: null as number | null,
      hint: 'Since the 1st',
    },
    {
      label: 'Total earned',
      value: lifetimeUsd,
      kes: visibleEarnedKes,
      earned: true,
      hint: 'Total money earned',
    },
  ]
  const userCounts = resolveUserPeriodCounts(data.users, today, {
    yesterday: data.totals.usersYesterday,
    today: data.totals.usersToday,
    week: data.totals.usersWeek,
    month: data.totals.usersMonth,
    lifetime: data.totals.userCount,
  })
  const users = [
    { key: 'yesterday', label: 'Total users yesterday', value: userCounts.yesterday, hint: `Joined on ${yesterday}` },
    { key: 'today', label: 'Total users today', value: userCounts.today, hint: 'Joined since midnight' },
    { key: 'week', label: 'Total users this week', value: userCounts.week, hint: 'Joined since Monday' },
    { key: 'month', label: 'Total users this month', value: userCounts.month, hint: 'Joined since the 1st' },
    { key: 'lifetime', label: 'Total users', value: userCounts.lifetime, hint: 'Every account' },
  ]

  return (
    <div className="space-y-6">
      <section className="space-y-3" data-testid="admin-money-periods">
        <h2 className="font-display text-lg font-semibold text-paper">Money</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {money.map((item) => (
            <Stat
              key={item.label}
              label={item.label}
              value={item.earned ? formatEarnedKes(item.kes ?? 0) : formatMoney(item.value)}
              subValue={item.earned ? undefined : formatKes(item.kes ?? usdToKes(item.value, rate))}
              hint={item.hint}
              tone="live"
            />
          ))}
        </div>
      </section>
      <section className="space-y-3" data-testid="admin-earned-split">
        <h2 className="font-display text-lg font-semibold text-paper">Total earned split</h2>
        <p className="text-sm text-mist">
          {`Total money earned is ${formatEarnedKes(earnedSplit.sharedKes)}. sonshas and rulli each receive 50%. A 5% receivers share of that total is taken from each admin.`}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {earnedSplit.shares.map((share) => (
            <Card key={share.key} data-testid={`admin-earned-share-${share.key}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-mist">50%</p>
              <h3 className="font-display text-lg font-semibold text-paper">{share.key}</h3>
              <p className="text-xs text-mist">{share.email}</p>
              <p className="mt-3 font-mono text-xl font-semibold text-live">{formatEarnedKes(share.netKes)}</p>
              <p className="mt-1 text-xs text-paper">Earned after 5% charge</p>
              <p className="mt-2 text-xs text-mist">50% split {formatEarnedKes(share.grossKes)}</p>
              <p className="text-xs text-mist">Receivers share 5% {formatEarnedKes(share.chargeKes)}</p>
            </Card>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {earnedSplit.shares.map((share) => (
            <Stat
              key={`${share.key}-receiver`}
              label={`${share.key} receivers share 5%`}
              value={formatEarnedKes(share.chargeKes)}
              hint="5% of total earned"
            />
          ))}
        </div>
      </section>
      <section className="space-y-3" data-testid="admin-yesterday-shares">
        <h2 className="font-display text-lg font-semibold text-paper">Yesterday admin split</h2>
        <p className="text-sm text-mist">
          {`Nairobi day ${yesterday}: sonshas and rulli each receive 50%.`}
        </p>
        <AdminShareStrip
          split={yesterdaySplit}
          rate={rate}
          testId="admin-yesterday-share-grid"
          shareTestIdPrefix="admin-yesterday-share"
        />
      </section>
      <section className="space-y-3" data-testid="admin-user-periods">
        <h2 className="font-display text-lg font-semibold text-paper">Users</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {users.map((item) => (
            <div key={item.label} data-testid={`admin-user-stat-${item.key}`}>
              <Stat label={item.label} value={String(item.value)} hint={item.hint} />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function DailyDepositsPanel({
  rows,
  shownAmounts,
  rate,
}: {
  rows: DashboardDepositRow[]
  shownAmounts: Map<string, number>
  rate: number
}) {
  const today = nairobiDateKey(new Date().toISOString()) ?? '1970-01-01'
  const yesterday = shiftDateKey(today, -1)
  const [draftDay, setDraftDay] = useState(yesterday)
  const [selectedDay, setSelectedDay] = useState(yesterday)

  const dayRows = useMemo(
    () =>
      rows.filter(
        (row) => nairobiDateKey(row.creditedAt ?? row.createdAt) === selectedDay && shownAmounts.has(row.id),
      ),
    [rows, selectedDay, shownAmounts],
  )
  const earnedUsd = useMemo(
    () =>
      Math.round(
        (dayRows.reduce((sum, row) => sum + (shownAmounts.get(row.id) ?? 0), 0) + Number.EPSILON) * 100,
      ) / 100,
    [dayRows, shownAmounts],
  )
  const daySplit = useMemo(() => splitEqualPartners(earnedUsd), [earnedUsd])

  function applyDay(next: string) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(next) ? next : today
    setDraftDay(day)
    setSelectedDay(day)
  }

  return (
    <section className="space-y-4" data-testid="admin-daily-deposits">
      <div className="space-y-1">
        <h2 className="font-display text-lg font-semibold text-paper">Daily deposits</h2>
        <p className="text-sm text-mist">
          Pick any Nairobi calendar day to see money earned and each admin's share.
        </p>
      </div>

      <form
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          applyDay(draftDay)
        }}
      >
        <div className="min-w-[12rem] flex-1 sm:max-w-xs">
          <Input
            label="Day"
            type="date"
            value={draftDay}
            max={today}
            onChange={(event) => setDraftDay(event.target.value)}
            data-testid="admin-daily-deposits-date"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" data-testid="admin-daily-deposits-show">
            Show day
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => applyDay(yesterday)}
            data-testid="admin-daily-deposits-yesterday"
          >
            Yesterday
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => applyDay(today)}
            data-testid="admin-daily-deposits-today"
          >
            Today
          </Button>
        </div>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="admin-daily-deposits-stats">
        <Stat
          label={`Money earned · ${formatDayLabel(selectedDay)}`}
          value={formatMoney(earnedUsd)}
          subValue={formatKes(usdToKes(earnedUsd, rate))}
          hint="Completed payments credited that day"
          tone="live"
        />
        <Stat
          label="Payments that day"
          value={String(dayRows.length)}
          hint={dayRows.length === 1 ? '1 completed payment' : `${dayRows.length} completed payments`}
        />
      </div>

      <AdminShareStrip
        split={daySplit}
        rate={rate}
        testId="admin-daily-deposits-shares"
        shareTestIdPrefix="admin-daily-share"
      />

      {dayRows.length === 0 ? (
        <p className="text-sm text-mist" data-testid="admin-daily-deposits-empty">
          No completed deposits on {formatDayLabel(selectedDay)}.
        </p>
      ) : (
        <DepositTable rows={dayRows} rate={rate} shownAmounts={shownAmounts} />
      )}
    </section>
  )
}

function DepositTable({
  rows,
  rate,
  shownAmounts,
}: {
  rows: DashboardDepositRow[]
  rate: number
  shownAmounts?: Map<string, number>
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-line bg-ink-2/80 text-[11px] font-semibold uppercase tracking-wider text-mist">
          <tr>
            <th className="px-3 py-2 font-semibold">Who paid</th>
            <th className="px-3 py-2 font-semibold">Payment</th>
            <th className="px-3 py-2 font-semibold">Amount</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">Receipt</th>
            <th className="px-3 py-2 font-semibold">Credited</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const shown = shownAmounts?.get(row.id)
            const kes = shown != null ? formatKes(usdToKes(shown, rate)) : kesLine(row.amountUsd, row.amountKes, rate)
            return (
              <tr key={row.id} className="border-b border-line/80 last:border-0" data-testid="admin-deposit-row">
                <td className="px-3 py-2 text-paper">{payer(row)}</td>
                <td className="px-3 py-2 text-paper">{row.payment || 'Deposit'}</td>
                <td className="px-3 py-2 font-mono text-paper">
                  <span className="block">{shown != null ? formatMoney(shown) : usdLine(row.amountUsd, row.amountKes, rate)}</span>
                  {kes ? <span className="mt-0.5 block text-xs text-mist">{kes}</span> : null}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                  {row.provider ? <p className="mt-1 text-[11px] text-mist">{row.provider}</p> : null}
                </td>
                <td className="px-3 py-2 font-mono text-paper">{row.receipt ?? '—'}</td>
                <td className="px-3 py-2 text-mist">{when(row.creditedAt ?? row.createdAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
