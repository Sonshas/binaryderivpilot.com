import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, PageHeader, Skeleton, Stat } from '@/components/ui'
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
  type DashboardUserRow,
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

const NAIROBI = 'Africa/Nairobi'

function dateKey(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NAIROBI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function shiftKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10)
}

function weekStartKey(today: string): string {
  const [year, month, day] = today.split('-').map(Number)
  const weekday = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay()
  return shiftKey(today, weekday === 0 ? -6 : 1 - weekday)
}

function inSpan(key: string | null, start: string, end: string): boolean {
  return key != null && key >= start && key <= end
}

function depositUsd(row: DashboardDepositRow, rate = depositRate()): number {
  if (row.amountUsd != null) return row.amountUsd
  if (row.amountKes != null) return kesToUsd(row.amountKes, rate)
  return 0
}

function moneyInSpan(rows: DashboardDepositRow[], start: string, end: string, rate = depositRate()): number {
  const sum = rows.reduce((total, row) => {
    const key = dateKey(row.creditedAt ?? row.createdAt)
    return inSpan(key, start, end) ? total + depositUsd(row, rate) : total
  }, 0)
  return Math.round((sum + Number.EPSILON) * 100) / 100
}

function usersInSpan(rows: DashboardUserRow[], start: string, end: string): number {
  return rows.filter((row) => inSpan(dateKey(row.signedUpAt), start, end)).length
}

export function RealAdminDashboard() {
  const { isSignedIn } = useAuthSession()
  const [data, setData] = useState<AdminDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!isSignedIn) return
    setLoading(true)
    const result = await adminDashboardService.load()
    setLoading(false)
    if (result.ok) {
      setData(result.data)
      setError(null)
    } else {
      setData(null)
      setError(result.error === 'Forbidden' ? 'This page is limited to admin, superadmin, and finance accounts.' : result.error)
    }
  }, [isSignedIn])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-8" data-testid="admin-dashboard">
      <PageHeader
        title="Dashboard"
        subtitle="Successful deposits and service payments from the deposits list. Today, this week, and this month use Nairobi time."
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
          <DashboardPeriods data={data} />

          <section className="space-y-3" data-testid="admin-dashboard-collected">
            <h2 className="font-display text-lg font-semibold text-paper">Money collected</h2>
            <p className="text-sm text-mist">
              {data.totals.collectedCount === 0
                ? 'No successful deposits or service payments yet. The total above is zero.'
                : `${data.totals.collectedCount} successful payment${data.totals.collectedCount === 1 ? '' : 's'} · ${usdLine(data.totals.collectedUsd, data.totals.collectedKes, depositRate())}`}
            </p>
            {data.collected.length === 0 ? (
              <p className="text-sm text-mist">No credited M-Pesa deposits.</p>
            ) : (
              <DepositTable rows={data.collected} rate={depositRate()} />
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}

function DashboardPeriods({ data }: { data: AdminDashboard }) {
  const rate = depositRate()
  const today = dateKey(new Date().toISOString()) ?? '1970-01-01'
  const weekStart = weekStartKey(today)
  const monthStart = `${today.slice(0, 8)}01`
  const lifetimeMoney = Math.round((data.collected.reduce((sum, row) => sum + depositUsd(row, rate), 0) + Number.EPSILON) * 100) / 100
  const money = [
    { label: 'Total money today', value: moneyInSpan(data.collected, today, today, rate), hint: 'Since midnight' },
    { label: 'Total money this week', value: moneyInSpan(data.collected, weekStart, today, rate), hint: 'Since Monday' },
    { label: 'Total money this month', value: moneyInSpan(data.collected, monthStart, today, rate), hint: 'Since the 1st' },
    { label: 'Total money (lifetime)', value: lifetimeMoney, hint: `${data.totals.collectedCount} completed payments` },
  ]
  const users = [
    { label: 'Total users today', value: usersInSpan(data.users, today, today), hint: 'Joined since midnight' },
    { label: 'Total users this week', value: usersInSpan(data.users, weekStart, today), hint: 'Joined since Monday' },
    { label: 'Total users this month', value: usersInSpan(data.users, monthStart, today), hint: 'Joined since the 1st' },
    { label: 'Total users', value: data.users.length, hint: 'Every account' },
  ]

  return (
    <div className="space-y-6">
      <section className="space-y-3" data-testid="admin-money-periods">
        <h2 className="font-display text-lg font-semibold text-paper">Money</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {money.map((item) => (
            <Stat
              key={item.label}
              label={item.label}
              value={formatMoney(item.value)}
              subValue={formatKes(usdToKes(item.value, rate))}
              hint={item.hint}
              tone="live"
            />
          ))}
        </div>
      </section>
      <section className="space-y-3" data-testid="admin-user-periods">
        <h2 className="font-display text-lg font-semibold text-paper">Users</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {users.map((item) => (
            <Stat key={item.label} label={item.label} value={String(item.value)} hint={item.hint} />
          ))}
        </div>
      </section>
    </div>
  )
}

function DepositTable({ rows, rate }: { rows: DashboardDepositRow[]; rate: number }) {
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
            const kes = kesLine(row.amountUsd, row.amountKes, rate)
            return (
              <tr key={row.id} className="border-b border-line/80 last:border-0" data-testid="admin-deposit-row">
                <td className="px-3 py-2 text-paper">{payer(row)}</td>
                <td className="px-3 py-2 text-paper">{row.payment || 'Deposit'}</td>
                <td className="px-3 py-2 font-mono text-paper">
                  <span className="block">{usdLine(row.amountUsd, row.amountKes, rate)}</span>
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
