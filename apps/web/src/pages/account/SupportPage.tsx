import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Card, EmptyState, Input, PageHeader, Textarea } from '@/components/ui'
import { useAccountMode } from '@/hooks/useAccountMode'
import { useSupportTickets } from '@/hooks/useBots'
import { notifySupportChanged } from '@/lib/support-events'
import { supportService } from '@/services/notifications'

export function SupportPage() {
  const { kind } = useAccountMode()
  const { tickets, loading } = useSupportTickets()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const marking = useRef(false)

  useEffect(() => {
    if (marking.current) return
    if (!tickets.some((ticket) => ticket.reply && ticket.replyRead !== true)) return
    marking.current = true
    void supportService.markRepliesRead(kind).then((marked) => {
      marking.current = false
      if (marked.connected) notifySupportChanged()
    })
  }, [tickets, kind])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (subject.trim().length < 3) next.subject = 'Enter a subject of at least 3 characters.'
    if (message.trim().length < 10) next.message = 'Enter a message of at least 10 characters.'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    const created = await supportService.createTicket({ subject, message, kind })
    setResult(created.connected ? 'Message sent. A reply will show here and when you sign in.' : 'Your ticket could not be submitted. Please try again later.')
    setBusy(false)
    if (created.connected) {
      setSubject('')
      setMessage('')
      notifySupportChanged()
    }
  }

  return (
    <div>
      <PageHeader title="Support" subtitle="Send a message. Replies from support appear on this page." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <form className="space-y-3" onSubmit={(event) => void onSubmit(event)}>
            <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} error={errors.subject} />
            <Textarea label="Message" value={message} onChange={(e) => setMessage(e.target.value)} error={errors.message} />
            {result ? <p className="text-sm text-paper">{result}</p> : null}
            <Button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Submit ticket'}
            </Button>
          </form>
        </Card>
        <Card>
          {loading ? null : tickets.length === 0 ? (
            <EmptyState title="No tickets yet" />
          ) : (
            <ul className="divide-y divide-line/60">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="py-3">
                  <p className="text-sm font-semibold text-paper">{ticket.subject}</p>
                  <p className="mt-0.5 text-sm text-mist">{ticket.message}</p>
                  <p className="mt-1 text-[11px] uppercase text-mist">{ticket.status}</p>
                  {ticket.reply ? (
                    <div className="mt-2 rounded-lg border border-line bg-ink-2 px-3 py-2">
                      <p className="text-[11px] uppercase text-mist">Support reply</p>
                      <p className="mt-1 text-sm text-paper">{ticket.reply}</p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-mist">Waiting for a reply.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
