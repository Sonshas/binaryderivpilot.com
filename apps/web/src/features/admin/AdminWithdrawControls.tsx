import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Badge, Button, Card, Input, PageHeader } from '@/components/ui'
import { formatKes } from '@/features/payments/MoneyPair'
import { WithdrawFeeModal } from '@/features/wallet/WithdrawFeeModal'
import {
  scannerFeeNote,
  taxFeeNote,
  verificationFeeNote,
} from '@/features/wallet/withdraw-gate-copy'
import {
  readExternalPayments,
  readWithdrawOrder,
  WITHDRAW_STEP_LABEL,
  type ExternalKind,
} from '@/lib/external-payments'
import { formatMoney } from '@/lib/format'
import { usdToKes, withdrawalStatusLabel } from '@/domain/withdrawals'
import { realAccountShort } from '@/lib/branding'
import { platformSettingsService } from '@/services/platform-settings'

type PreviewKind = 'success' | ExternalKind | null

function numInput(value: string, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function WithdrawSuccessPreview({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close success preview" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="withdraw-success-preview-title"
        data-testid="admin-withdraw-success-preview"
        className="relative z-10 max-h-[92svh] w-full max-w-md overflow-y-auto rounded-2xl border border-live/40 bg-surface p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="withdraw-success-preview-title" className="font-display font-semibold">
            Withdraw to M-Pesa
          </h2>
          <Badge tone="live">{realAccountShort()}</Badge>
        </div>
        <p className="mt-1 text-xs text-mist">
          Withdrawals are paid to your M-Pesa number after review. Your request will be processed shortly.
        </p>
        <div className="mt-3 space-y-3" data-testid="real-withdraw-status" data-status="PENDING">
          <Alert tone="signal" title={withdrawalStatusLabel('PENDING')}>
            Withdrawal requested successfully. It will be processed shortly. {formatMoney(20)} (KES 2,600) will be
            sent to 0712345678.
          </Alert>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-mist">Reference</dt>
            <dd className="text-right font-mono">OMT-W-PREVIEW1</dd>
            <dt className="text-mist">Amount</dt>
            <dd className="text-right font-mono">{formatMoney(20)} · {formatKes(2600)}</dd>
            <dt className="text-mist">Fee</dt>
            <dd className="text-right font-mono">{formatMoney(0)} · {formatKes(0)}</dd>
            <dt className="text-mist">You receive</dt>
            <dd className="text-right font-mono text-live">{formatMoney(20)} · {formatKes(2600)}</dd>
            <dt className="text-mist">M-Pesa number</dt>
            <dd className="text-right font-mono">0712345678</dd>
            <dt className="text-mist">Status</dt>
            <dd className="text-right">
              <Badge tone="live">Successful</Badge>
            </dd>
            <dt className="text-mist">Requested</dt>
            <dd className="text-right">{new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
          </dl>
          <p className="text-xs text-mist">Preview only — sample amounts.</p>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close preview
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function AdminWithdrawControls() {
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewKind>(null)
  const [defaultKesPerUsd, setDefaultKesPerUsd] = useState(() => readExternalPayments().defaultKesPerUsd)
  const [scannerUsd, setScannerUsd] = useState(() => readExternalPayments().scannerUsd)
  const [verificationUsd, setVerificationUsd] = useState(() => readExternalPayments().verificationUsd)
  const [taxUsd, setTaxUsd] = useState(() => readExternalPayments().taxUsd)
  const [scannerEnabled, setScannerEnabled] = useState(() => readExternalPayments().scannerEnabled)
  const [verificationEnabled, setVerificationEnabled] = useState(() => readExternalPayments().verificationEnabled)
  const [taxEnabled, setTaxEnabled] = useState(() => readExternalPayments().taxEnabled)
  const [withdrawOrder, setWithdrawOrder] = useState<ExternalKind[]>(() => readWithdrawOrder())

  function moveStep(index: number, direction: -1 | 1) {
    setWithdrawOrder((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = current.slice()
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item!)
      return next
    })
  }

  useEffect(() => {
    void platformSettingsService.load().then((result) => {
      if (!result.ok) return
      const saved = result.data.withdraw
      setDefaultKesPerUsd(saved.defaultKesPerUsd)
      setScannerUsd(saved.scannerUsd)
      setVerificationUsd(saved.verificationUsd)
      setTaxUsd(saved.taxUsd)
      setScannerEnabled(saved.scannerEnabled)
      setVerificationEnabled(saved.verificationEnabled)
      setTaxEnabled(saved.taxEnabled)
      setWithdrawOrder(saved.withdrawOrder)
    })
  }, [])

  async function onSave(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    const result = await platformSettingsService.saveWithdraw({
      scannerUsd,
      verificationUsd,
      taxUsd,
      defaultKesPerUsd,
      scannerEnabled,
      verificationEnabled,
      taxEnabled,
      withdrawOrder,
    })
    setSaving(false)
    if (!result.ok) {
      setMessage(result.error)
      return
    }
    const saved = result.data
    setDefaultKesPerUsd(saved.defaultKesPerUsd)
    setScannerUsd(saved.scannerUsd)
    setVerificationUsd(saved.verificationUsd)
    setTaxUsd(saved.taxUsd)
    setScannerEnabled(saved.scannerEnabled)
    setVerificationEnabled(saved.verificationEnabled)
    setTaxEnabled(saved.taxEnabled)
    setWithdrawOrder(saved.withdrawOrder)
    setMessage('Withdrawal controls saved for every account.')
  }

  const rate = defaultKesPerUsd
  const feePreviews: Record<
    ExternalKind,
    { title: string; note: string; amountUsd: number; testId: string; kind: ExternalKind }
  > = {
    verification: {
      title: 'Account verification',
      note: verificationFeeNote(verificationUsd, rate),
      amountUsd: verificationUsd,
      testId: 'admin-preview-verification-fee',
      kind: 'verification',
    },
    scanner: {
      title: 'AI scanner',
      note: scannerFeeNote(scannerUsd, rate),
      amountUsd: scannerUsd,
      testId: 'admin-preview-scanner-fee',
      kind: 'scanner',
    },
    tax: {
      title: 'Tax compliance',
      note: taxFeeNote(taxUsd, rate),
      amountUsd: taxUsd,
      testId: 'admin-preview-tax-fee',
      kind: 'tax',
    },
  }

  const activeFee = preview && preview !== 'success' ? feePreviews[preview] : null

  return (
    <div>
      <PageHeader
        title="Withdrawal controls"
        subtitle="Order and switch the steps a member sees when they withdraw. A step turned off here is off for every account unless you change that person on Users. Wallet payout rate/fee stay under Fees — this page only controls the three gate prompts."
      />
      <form className="space-y-4" onSubmit={onSave} data-testid="admin-withdraw-controls">
        {message ? <Alert tone="signal">{message}</Alert> : null}
        <Card className="space-y-3">
          <div>
            <p className="font-semibold text-paper">Gate prompt rate</p>
            <p className="text-sm text-mist">
              KES per $1 for scanner, verification, and tax M-Pesa prompts only.
              Separate from Fees → deposit rate and Fees → payout rate.
            </p>
          </div>
          <div className="max-w-xs">
            <Input
              label="Default rate"
              hint="Starts at 130."
              type="number"
              step="0.0001"
              value={String(defaultKesPerUsd)}
              onChange={(event) => setDefaultKesPerUsd(numInput(event.target.value, defaultKesPerUsd))}
            />
          </div>
        </Card>
        <Card className="space-y-3">
          <div>
            <p className="font-semibold text-paper">Withdrawal steps</p>
            <p className="text-sm text-mist">
              The first row appears first. Payments stay separate M-Pesa prompts and are not taken from the trading balance. An amount of zero hides the scanner and tax prompts.
            </p>
          </div>
          <ol className="grid gap-2">
            {withdrawOrder.map((step, index) => {
              const on = step === 'scanner' ? scannerEnabled : step === 'verification' ? verificationEnabled : taxEnabled
              const amount = step === 'scanner' ? scannerUsd : step === 'verification' ? verificationUsd : taxUsd
              return (
                <li key={step} className="grid gap-2 rounded-xl border border-line bg-ink-2 px-3 py-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
                  <p className="pb-2 font-mono text-sm text-mist">{index + 1}</p>
                  <div className="space-y-2">
                    <Input
                      label={WITHDRAW_STEP_LABEL[step]}
                      hint={step === 'verification' ? 'ID photos. Amount is an optional review fee.' : 'USD charged on the M-Pesa prompt'}
                      type="number"
                      step="0.01"
                      value={String(amount)}
                      onChange={(event) => {
                        const next = numInput(event.target.value, amount)
                        if (step === 'scanner') setScannerUsd(next)
                        else if (step === 'verification') setVerificationUsd(next)
                        else setTaxUsd(next)
                      }}
                    />
                    <label className="flex items-center gap-2 text-sm text-paper">
                      <input
                        type="checkbox"
                        checked={on}
                        data-testid={`fee-${step}-enabled`}
                        onChange={(event) => {
                          const checked = event.target.checked
                          if (step === 'scanner') setScannerEnabled(checked)
                          else if (step === 'verification') setVerificationEnabled(checked)
                          else setTaxEnabled(checked)
                        }}
                      />
                      On for all users
                    </label>
                    <p className="text-xs text-mist">
                      Prompt ≈ {formatKes(usdToKes(amount, rate))} at this rate
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="secondary" disabled={index === 0} onClick={() => moveStep(index, -1)}>
                        Up
                      </Button>
                      <Button type="button" size="sm" variant="secondary" disabled={index === withdrawOrder.length - 1} onClick={() => moveStep(index, 1)}>
                        Down
                      </Button>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      data-testid={`preview-${step}`}
                      onClick={() => setPreview(step)}
                    >
                      Preview modal
                    </Button>
                  </div>
                </li>
              )
            })}
          </ol>
        </Card>
        <Card className="space-y-3">
          <div>
            <p className="font-semibold text-paper">Member previews</p>
            <p className="text-sm text-mist">
              Opens the same overlays members see after a withdrawal request. Uses the amounts and rate on this page (save to apply them live).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" data-testid="preview-success" onClick={() => setPreview('success')}>
              Preview withdrawal success
            </Button>
            {withdrawOrder.map((step) => (
              <Button
                key={`preview-row-${step}`}
                type="button"
                variant="secondary"
                data-testid={`preview-bar-${step}`}
                onClick={() => setPreview(step)}
              >
                Preview {WITHDRAW_STEP_LABEL[step]}
              </Button>
            ))}
          </div>
        </Card>
        <Button type="submit" disabled={saving} data-testid="admin-withdraw-controls-save">
          {saving ? 'Saving…' : 'Save withdrawal controls'}
        </Button>
      </form>

      <WithdrawSuccessPreview open={preview === 'success'} onClose={() => setPreview(null)} />
      {activeFee ? (
        <WithdrawFeeModal
          open
          title={activeFee.title}
          note={activeFee.note}
          testId={activeFee.testId}
          kind={activeFee.kind}
          amountUsd={Math.max(0.01, activeFee.amountUsd)}
          paid={false}
          buttonLabel={`Send ${formatMoney(Math.max(0.01, activeFee.amountUsd))} prompt`}
          onPaid={() => undefined}
          onContinue={() => setPreview(null)}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  )
}
