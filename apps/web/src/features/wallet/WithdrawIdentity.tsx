import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import { KycModal } from '@/features/wallet/KycModal'
import { fetchOwnKyc, identityOnFile, loadKyc, type KycRecord } from '@/lib/kyc'

export function identityReady(record: KycRecord | null): boolean {
  return identityOnFile(record)
}

export function WithdrawIdentity({
  email,
  onChange,
}: {
  email: string
  onChange: (record: KycRecord | null) => void
}) {
  const [record, setRecord] = useState<KycRecord | null>(() => loadKyc(email))
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchOwnKyc(email).then((next) => {
      if (!cancelled) setRecord(next)
    })
    return () => {
      cancelled = true
    }
  }, [email])

  useEffect(() => {
    onChange(record)
  }, [record, onChange])

  const ready = identityOnFile(record)

  return (
    <div className="mt-3 rounded-lg border border-line bg-ink px-3 py-3" data-testid="withdraw-identity">
      <p className="text-sm font-semibold text-paper">Account verification</p>
      <p className="mt-1 text-xs text-mist">
        Your ID photos are matched to the M-Pesa number before the payout is sent.
      </p>
      {ready && record?.status === 'approved' ? (
        <p className="mt-3 text-sm text-paper" data-testid="withdraw-identity-status">
          ID photos verified.
        </p>
      ) : ready && record?.status === 'pending' ? (
        <p className="mt-3 text-sm text-paper" data-testid="withdraw-identity-status">
          Photos submitted. Front, back, and holding photos are on file for payout review.
        </p>
      ) : (
        <Button type="button" className="mt-3" onClick={() => setOpen(true)} data-testid="withdraw-identity-open">
          {record?.status === 'rejected' ? 'Submit photos again' : 'Verify identity'}
        </Button>
      )}
      {record?.status === 'rejected' && !ready ? (
        <p className="mt-2 text-xs text-danger">{record.reviewNote || 'Those details could not be confirmed. Send the photos again.'}</p>
      ) : null}
      <KycModal
        email={email}
        open={open}
        onClose={() => setOpen(false)}
        onSubmitted={(next) => {
          setRecord(next)
          setOpen(false)
        }}
      />
    </div>
  )
}
