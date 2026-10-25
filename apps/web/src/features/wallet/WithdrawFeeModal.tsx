import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui'
import { ExternalStkPay } from '@/features/payments/ExternalStkPay'
import type { ExternalStkKind } from '@/services/scanner-stk'

export function WithdrawFeeModal({
  open,
  title,
  note,
  testId,
  kind,
  amountUsd,
  paid,
  buttonLabel,
  onPaid,
  onContinue,
  onClose,
}: {
  open: boolean
  title: string
  note: string
  testId: string
  kind: ExternalStkKind
  amountUsd: number
  paid: boolean
  buttonLabel: string
  onPaid: () => void
  onContinue: () => void
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/70" aria-label={`Close ${title}`} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-title`}
        data-testid={testId}
        className="relative z-10 max-h-[92svh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${testId}-title`} className="font-display text-lg font-bold text-paper">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-mist hover:text-paper" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm text-mist">{note}</p>
        <div className="mt-4">
          <ExternalStkPay kind={kind} amountUsd={amountUsd} paid={paid} onPaid={onPaid} buttonLabel={buttonLabel} />
        </div>
        <Button
          type="button"
          variant="secondary"
          className="mt-4 w-full"
          disabled={!paid}
          title={paid ? undefined : 'Complete this M-Pesa payment before continuing'}
          onClick={onContinue}
          data-testid={`${testId}-continue`}
        >
          Continue
        </Button>
      </div>
    </div>,
    document.body,
  )
}

export function WithdrawNoteModal({
  open,
  title,
  note,
  testId,
  onContinue,
  onClose,
}: {
  open: boolean
  title: string
  note: string
  testId: string
  onContinue: () => void
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/70" aria-label={`Close ${title}`} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-title`}
        data-testid={testId}
        className="relative z-10 w-full max-w-md rounded-2xl border border-line bg-surface p-4 shadow-2xl"
      >
        <h2 id={`${testId}-title`} className="font-display text-lg font-bold text-paper">
          {title}
        </h2>
        <p className="mt-2 text-sm text-mist">{note}</p>
        <Button type="button" className="mt-4 w-full" onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>,
    document.body,
  )
}
