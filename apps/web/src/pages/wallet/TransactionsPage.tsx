import { Badge, Card, DataTable, EmptyState, PageHeader } from '@/components/ui'
import { useAccountMode } from '@/hooks/useAccountMode'
import { useWalletHistory } from '@/hooks/useWallet'
import { accountModeLabel } from '@/domain/account'
import { formatMoney, transactionTypeLabel } from '@/lib/format'
import { demoAccountShort } from '@/lib/branding'

export function TransactionsPage() {
  const { kind } = useAccountMode()
  const { transactions, deposits, withdrawals, loading, message } = useWalletHistory(kind)
  const isDemo = kind === 'demo'

  const rows = transactions.map((item) => [
    `${isDemo ? `${demoAccountShort().toUpperCase()} ` : ''}${transactionTypeLabel(item.type)}`,
    formatMoney(item.amount),
    item.status,
    item.note ?? item.reference ?? '—',
    isDemo ? item.createdAt.slice(11, 19) : new Date(item.createdAt).toLocaleString(),
  ])

  const depositRows = deposits.map((item) => [
    item.provider === 'megapay' || item.provider === 'daraja' ? 'M-Pesa' : item.method,
    formatMoney(item.amount),
    item.status,
    item.reference ?? item.id.slice(0, 12),
    new Date(item.createdAt).toLocaleString(),
  ])

  return (
    <div>
      <PageHeader
        title={isDemo ? `${demoAccountShort()} Transactions` : 'Transactions'}
        subtitle={isDemo ? `${demoAccountShort()} withdrawals, stakes, and payouts.` : undefined}
        actions={<Badge tone={isDemo ? 'demo' : 'live'}>{accountModeLabel(kind)}</Badge>}
      />
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <h2 className="font-display font-semibold">Deposits</h2>
          <p className="mt-2 font-mono text-2xl">{isDemo ? '—' : loading ? '…' : deposits.length}</p>
        </Card>
        <Card>
          <h2 className="font-display font-semibold">{isDemo ? `${demoAccountShort()} Withdrawals` : 'Withdrawals'}</h2>
          <p className="mt-2 font-mono text-2xl">{loading && !isDemo ? '…' : withdrawals.length}</p>
        </Card>
        <Card>
          <h2 className="font-display font-semibold">{isDemo ? `${demoAccountShort()} Ledger` : 'Ledger'}</h2>
          <p className="mt-2 font-mono text-2xl">{loading && !isDemo ? '…' : transactions.length}</p>
        </Card>
      </div>
      {loading && !isDemo ? <p className="mt-4 text-sm text-mist">Loading transactions and deposits…</p> : null}
      {!loading && message && !isDemo ? <p className="mt-3 text-sm text-mist">{message}</p> : null}
      {!loading || isDemo ? (
        <Card className="mt-4">
          <DataTable
            columns={['Type', 'Amount', 'Status', 'Note', 'Time']}
            rows={rows}
            empty={
              <EmptyState
                title={isDemo ? `No ${demoAccountShort()} transactions yet` : 'No transactions yet'}
                body={isDemo ? `Place ${demoAccountShort()} trades to populate this ledger.` : message || undefined}
              />
            }
          />
        </Card>
      ) : null}
      {!isDemo && !loading ? (
        <Card className="mt-4">
          <h2 className="mb-3 font-display font-semibold">Deposits</h2>
          <DataTable
            columns={['Method', 'Amount', 'Status', 'Reference', 'Time']}
            rows={depositRows}
            empty={<EmptyState title="No deposits yet" />}
          />
        </Card>
      ) : null}
    </div>
  )
}
