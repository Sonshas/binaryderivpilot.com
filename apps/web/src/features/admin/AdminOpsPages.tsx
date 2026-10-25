import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Card, EmptyState, Input, PageHeader, Textarea } from '@/components/ui'
import { formatMoney } from '@/lib/format'
import { demoAccountShort, realAccountShort } from '@/lib/branding'
import { adminUsersService } from '@/services/admin-users'

function when(iso: unknown) {
  if (typeof iso !== 'string' || !iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function useLoad<T>(loader: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const refresh = useCallback(async () => {
    setLoading(true)
    const result = await loaderRef.current()
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      setData(null)
      return
    }
    setError('')
    setData(result.data)
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { data, error, loading, refresh }
}

export function AdminAuditPage() {
  const { data, error, loading, refresh } = useLoad(() => adminUsersService.auditList())
  const rows = data?.rows ?? []
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Admin actions across the site." actions={<Button type="button" size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>} />
      {error ? <p className="text-sm text-put">{error}</p> : null}
      {loading ? <p className="text-sm text-mist">Loading…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState title="No audit rows" body="Admin changes will appear here." /> : null}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={String(row.id)} className="rounded-xl border border-line px-3 py-2 text-sm">
            {when(row.created_at)} · {String(row.actor_email ?? 'admin')} · {String(row.action)}
            {row.user_id ? ` · user ${String(row.user_id).slice(0, 8)}…` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AdminMarketsPage() {
  const { data, error, loading, refresh } = useLoad(() => adminUsersService.marketsList())
  const markets = data?.markets ?? []
  return (
    <div>
      <PageHeader title="Markets" subtitle="Enable or disable trade symbols." actions={<Button type="button" size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>} />
      {error ? <p className="text-sm text-put">{error}</p> : null}
      {loading ? <p className="text-sm text-mist">Loading…</p> : null}
      <div className="grid gap-2">
        {markets.map((row) => (
          <Card key={String(row.symbol)} className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold">{String(row.display_name ?? row.symbol)}</p>
              <p className="text-sm text-mist">{String(row.symbol)} · {String(row.category ?? '')}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant={row.is_active ? 'secondary' : 'primary'}
              onClick={async () => {
                await adminUsersService.marketsUpdate(String(row.symbol), { is_active: !row.is_active })
                void refresh()
              }}
            >
              {row.is_active ? 'Disable' : 'Enable'}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  )
}

export function AdminStkQueuePage() {
  const { data, error, loading, refresh } = useLoad(() => adminUsersService.stkQueue())
  const rows = data?.rows ?? []
  return (
    <div>
      <PageHeader title="STK queue" subtitle="Pending, failed, and cancelled M-Pesa deposit attempts." actions={<Button type="button" size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>} />
      {error ? <p className="text-sm text-put">{error}</p> : null}
      {loading ? <p className="text-sm text-mist">Loading…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState title="Queue empty" body="No open or failed STK rows." /> : null}
      <ul className="space-y-2 text-sm">
        {rows.map((row) => (
          <li key={String(row.id)} className="rounded-xl border border-line px-3 py-2">
            {when(row.created_at)} · {String(row.status)} · {formatMoney(Number(row.amount ?? 0))} · user {String(row.user_id).slice(0, 8)}…
            {row.result_desc ? ` · ${String(row.result_desc)}` : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AdminMegapayPage() {
  const { data, error, loading, refresh } = useLoad(() => adminUsersService.megapayEvents())
  const rows = data?.rows ?? []
  return (
    <div>
      <PageHeader title="MegaPay events" subtitle="Webhook idempotency log for MegaPay deposits." actions={<Button type="button" size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>} />
      {error ? <p className="text-sm text-put">{error}</p> : null}
      {loading ? <p className="text-sm text-mist">Loading…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState title="No events" body="MegaPay webhooks will show here." /> : null}
      <ul className="space-y-2 text-sm">
        {rows.map((row) => (
          <li key={String(row.id)} className="rounded-xl border border-line px-3 py-2">
            {when(row.received_at)} · {String(row.routed_to ?? 'unknown')} · processed={String(row.processed)} ·{' '}
            {String(row.process_result ?? row.reference ?? 'event')}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AdminDepositsLivePage() {
  const { data, error, loading, refresh } = useLoad(() => adminUsersService.depositsList())
  const rows = data?.rows ?? []
  return (
    <div>
      <PageHeader
        title="Deposits"
        subtitle={`Successful ${realAccountShort().toLowerCase()} deposits and service payments from Supabase.`}
        actions={<Button type="button" size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>}
      />
      {error ? <p className="text-sm text-put">{error}</p> : null}
      {loading ? <p className="text-sm text-mist">Loading…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState title="No successful payments yet" /> : null}
      <ul className="space-y-2 text-sm">
        {rows.map((row) => (
          <li key={String(row.id)} className="rounded-xl border border-line px-3 py-2">
            {when(row.credited_at ?? row.created_at)} · {String(row.user_email ?? String(row.user_id).slice(0, 8))} ·{' '}
            {String(row.payment ?? 'Deposit')} · {formatMoney(Number(row.amount_usd ?? 0))}
            {row.amount_kes != null ? ` · KES ${row.amount_kes}` : ''} · {String(row.receipt ?? row.provider ?? '')}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AdminTradesLivePage() {
  const { data, error, loading, refresh } = useLoad(() => adminUsersService.tradesList())
  const rows = data?.rows ?? []
  return (
    <div>
      <PageHeader
        title="Trades"
        subtitle={`${realAccountShort()} and ${demoAccountShort().toLowerCase()} trades recorded in the database.`}
        actions={<Button type="button" size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>}
      />
      {error ? <p className="text-sm text-put">{error}</p> : null}
      {loading ? <p className="text-sm text-mist">Loading…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState title="No trades yet" /> : null}
      <ul className="space-y-2 text-sm">
        {rows.map((row) => (
          <li key={String(row.id)} className="rounded-xl border border-line px-3 py-2">
            {when(row.created_at)} · {String(row.user_email ?? String(row.user_id).slice(0, 8))} · {String(row.symbol)} ·{' '}
            {String(row.contract_option ?? row.contract_type)} · stake {formatMoney(Number(row.stake ?? 0))} · {String(row.status)} ·{' '}
            {String(row.account_mode === 'demo' ? demoAccountShort() : realAccountShort())}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AdminLedgerLivePage() {
  const { data, error, loading, refresh } = useLoad(() => adminUsersService.ledgerList())
  const rows = data?.rows ?? []
  return (
    <div>
      <PageHeader
        title="Ledger"
        subtitle="Wallet movements from the live transactions table."
        actions={<Button type="button" size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>}
      />
      {error ? <p className="text-sm text-put">{error}</p> : null}
      {loading ? <p className="text-sm text-mist">Loading…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState title="No ledger rows yet" /> : null}
      <ul className="space-y-2 text-sm">
        {rows.map((row) => (
          <li key={String(row.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
            <div>
              <p className="font-semibold">
                {String(row.user_email ?? String(row.user_id).slice(0, 8))} · {String(row.type)}
              </p>
              <p className="text-mist">
                {String(row.note || row.status || '')} · {when(row.created_at)}
              </p>
            </div>
            <p className="font-mono">{formatMoney(Number(row.amount ?? 0))}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AdminSupportLivePage() {
  const { data, error, loading, refresh } = useLoad(() => adminUsersService.supportList())
  const rows = data?.rows ?? []
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <div>
      <PageHeader
        title="Support tickets"
        subtitle="Live tickets from Supabase. Replies notify the user."
        actions={<Button type="button" size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>}
      />
      {error ? <p className="mb-3 text-sm text-put">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-signal">{notice}</p> : null}
      {loading ? <p className="text-sm text-mist">Loading…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState title="No support tickets yet" /> : null}
      <div className="grid gap-2">
        {rows.map((ticket) => {
          const messages = Array.isArray(ticket.messages) ? (ticket.messages as Record<string, unknown>[]) : []
          const open = String(ticket.status) !== 'closed'
          return (
            <Card key={String(ticket.id)}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{String(ticket.subject)}</p>
                  <p className="text-xs text-mist">
                    {String(ticket.user_email ?? String(ticket.user_id).slice(0, 8))} · {String(ticket.status)} · {when(ticket.created_at)}
                  </p>
                  <p className="mt-2 text-sm">{String(ticket.message)}</p>
                  {messages.map((msg) => (
                    <p key={String(msg.id)} className="mt-2 text-sm text-paper">
                      {String(msg.sender_role)}: {String(msg.message)}
                    </p>
                  ))}
                </div>
                {open ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      const result = await adminUsersService.supportClose(String(ticket.id))
                      setBusy(false)
                      setNotice(result.ok ? 'Ticket closed.' : result.error)
                      if (result.ok) void refresh()
                    }}
                  >
                    Close
                  </Button>
                ) : (
                  <span className="text-xs uppercase text-mist">closed</span>
                )}
              </div>
              {open ? (
                <div className="mt-3 grid gap-2">
                  <Textarea
                    label="Reply"
                    value={drafts[String(ticket.id)] ?? ''}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [String(ticket.id)]: event.target.value }))}
                  />
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      const result = await adminUsersService.supportReply(String(ticket.id), drafts[String(ticket.id)] ?? '')
                      setBusy(false)
                      setNotice(result.ok ? 'Reply sent.' : result.error)
                      if (result.ok) {
                        setDrafts((prev) => ({ ...prev, [String(ticket.id)]: '' }))
                        void refresh()
                      }
                    }}
                  >
                    Send reply
                  </Button>
                </div>
              ) : null}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export function AdminNotificationsLivePage() {
  const { data, error, loading, refresh } = useLoad(() => adminUsersService.notificationsList())
  const rows = data?.rows ?? []
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(event: FormEvent) {
    event.preventDefault()
    if (title.trim().length < 2 || body.trim().length < 2) {
      setNotice('Enter a title and a message.')
      return
    }
    setBusy(true)
    const result = await adminUsersService.notifyBroadcast(title.trim(), body.trim())
    setBusy(false)
    if (!result.ok) {
      setNotice(result.error)
      return
    }
    setTitle('')
    setBody('')
    setNotice(`Sent to ${result.data.count ?? 0} account${(result.data.count ?? 0) === 1 ? '' : 's'}.`)
    void refresh()
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Broadcast to every live account and review recent notifications."
        actions={<Button type="button" size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>}
      />
      <Card className="mb-4">
        <form className="grid gap-3" onSubmit={(event) => void send(event)}>
          <Input label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
          <Input label="Message" value={body} onChange={(event) => setBody(event.target.value)} />
          <Button type="submit" disabled={busy}>
            Send to all accounts
          </Button>
          {notice ? <p className="text-sm text-mist">{notice}</p> : null}
        </form>
      </Card>
      {error ? <p className="text-sm text-put">{error}</p> : null}
      {loading ? <p className="text-sm text-mist">Loading…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState title="No notifications yet" /> : null}
      <ul className="space-y-2 text-sm">
        {rows.map((row) => (
          <li key={String(row.id)} className="rounded-xl border border-line px-3 py-2">
            {when(row.created_at)} · {String(row.user_email ?? String(row.user_id).slice(0, 8))} · {String(row.title)}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AdminVerificationLivePage() {
  const { data, error, loading, refresh } = useLoad(() => adminUsersService.kycList())
  const rows = data?.rows ?? []
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  return (
    <div>
      <PageHeader
        title="Verification"
        subtitle="Identity checks from Supabase. Approving or rejecting does not move any balance."
        actions={<Button type="button" size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>}
      />
      {error ? <p className="mb-3 text-sm text-put">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-signal">{notice}</p> : null}
      {loading ? <p className="text-sm text-mist">Loading…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState title="No verification submissions yet" /> : null}
      <div className="grid gap-2">
        {rows.map((row) => (
          <Card key={String(row.id)} className="text-sm">
            <p className="font-semibold">
              {String(row.user_email ?? String(row.user_id).slice(0, 8))} · {String(row.status)}
            </p>
            <p className="text-mist">{when(row.created_at)}</p>
            {Array.isArray(row.document_paths) && row.document_paths.length > 0 ? (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(row.document_paths as unknown[]).slice(0, 3).map((src, index) => {
                  const href = String(src ?? '')
                  const label = index === 0 ? 'Front' : index === 1 ? 'Back' : 'Holding'
                  return href.startsWith('data:image') || href.startsWith('http') ? (
                    <figure key={label}>
                      <img src={href} alt={label} className="h-24 w-full rounded bg-ink-2 object-contain" />
                      <figcaption className="mt-1 text-center text-[10px] text-mist">{label}</figcaption>
                    </figure>
                  ) : (
                    <p key={label} className="text-xs text-mist">{label}: {href || '—'}</p>
                  )
                })}
              </div>
            ) : (
              <p className="mt-1 text-mist">No photos on file.</p>
            )}
            {['pending', 'active'].includes(String(row.status)) ? (
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    const result = await adminUsersService.kycReview(String(row.user_id), String(row.id), 'approved')
                    setBusy(false)
                    setNotice(result.ok ? 'Approved.' : result.error)
                    if (result.ok) void refresh()
                  }}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    const result = await adminUsersService.kycReview(String(row.user_id), String(row.id), 'rejected')
                    setBusy(false)
                    setNotice(result.ok ? 'Rejected.' : result.error)
                    if (result.ok) void refresh()
                  }}
                >
                  Reject
                </Button>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  )
}
