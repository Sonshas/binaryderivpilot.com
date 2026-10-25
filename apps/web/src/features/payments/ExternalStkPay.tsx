import { useEffect, useRef, useState } from 'react'
import { Alert } from '@/components/ui'
import { normalizeKenyanPhone } from '@/domain/megapay'
import { promptKes, promptRate } from '@/lib/external-payments'
import { localBooksActive, recordLocalServiceCharge } from '@/lib/real-books'
import { PayBreakdown } from '@/features/payments/MoneyPair'
import { MpesaPhoneChoice } from '@/features/payments/MpesaPhoneChoice'
import { scannerStkService, type ExternalStkKind } from '@/services/scanner-stk'

export function ExternalStkPay({
  kind,
  amountUsd,
  paid,
  onPaid,
  buttonLabel,
}: {
  kind: ExternalStkKind
  amountUsd: number
  paid: boolean
  onPaid: () => void
  buttonLabel: string
}) {
  const [phone, setPhone] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<{ title: string; body: string; failed: boolean } | null>(null)
  const pollRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (pollRef.current != null) window.clearTimeout(pollRef.current)
    }
  }, [])

  if (paid) return <p className="text-sm text-paper">M-Pesa payment received. Your trading balance was not used.</p>

  async function send() {
    const msisdn = normalizeKenyanPhone(phone)
    if (!msisdn) {
      setNotice({ title: 'Phone number', body: 'Enter a valid Safaricom M-Pesa number, e.g. 0712345678.', failed: true })
      return
    }
    setSending(true)
    setNotice(null)
    const started = await scannerStkService.start(promptKes(amountUsd), msisdn, kind)
    setSending(false)
    if (!started.ok) {
      setNotice({ title: 'Payment prompt failed', body: 'Payment prompt failed. Contact support for assistance.', failed: true })
      return
    }
    setNotice({ title: 'Payment prompt sent', body: 'Check your phone and enter your M-Pesa PIN.', failed: false })
    const checkout = started.data.checkoutRequestId
    const startedAt = Date.now()
    const tick = async () => {
      if (Date.now() - startedAt > 120_000) {
        setNotice({ title: 'Failed', body: 'Contact support for assistance.', failed: true })
        return
      }
      const result = await scannerStkService.status(checkout)
      if (!result.ok) {
        setNotice({ title: 'Failed', body: 'Contact support for assistance.', failed: true })
        return
      }
      if (result.data.status === 'COMPLETED') {
        if (localBooksActive()) recordLocalServiceCharge(kind, amountUsd)
        onPaid()
        setNotice(null)
        return
      }
      if (result.data.status === 'FAILED' || result.data.status === 'CANCELLED') {
        setNotice({ title: 'Failed', body: 'Contact support for assistance.', failed: true })
        return
      }
      pollRef.current = window.setTimeout(() => void tick(), 3000)
    }
    pollRef.current = window.setTimeout(() => void tick(), 3000)
  }

  return (
    <div className="space-y-3">
      <PayBreakdown amountUsd={amountUsd} kesPerUsd={promptRate()} note="The trading balance is not used." />
      <MpesaPhoneChoice onChange={setPhone} testId={`stk-phone-${kind}`} />
      {notice ? (
        <Alert tone={notice.failed ? 'danger' : 'signal'} title={notice.title}>
          {notice.body}
        </Alert>
      ) : null}
      <button
        type="button"
        onClick={() => void send()}
        disabled={sending}
        className="flex h-12 w-full items-center justify-center rounded-xl bg-signal-strong text-sm font-bold text-white disabled:opacity-60"
        data-testid={`stk-pay-${kind}`}
      >
        {sending ? 'Sending prompt…' : buttonLabel}
      </button>
    </div>
  )
}
