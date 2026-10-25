import { kesToUsd } from '@/domain/megapay'
import { usdToKes } from '@/domain/withdrawals'
import { Input } from '@/components/ui'
import { formatMoney } from '@/lib/format'

export function formatKes(amount: number): string {
  return `KES ${Math.round(amount).toLocaleString('en-US')}`
}

export function rateLine(kesPerUsd: number): string {
  const rate = Number.isFinite(kesPerUsd) && kesPerUsd > 0 ? kesPerUsd : 130
  return `Rate: KES ${rate.toLocaleString('en-US')} = $1.00`
}

export function pairFromKes(kes: number, kesPerUsd: number): { kes: string; usd: string } {
  const whole = Math.max(0, Math.round(kes))
  return { kes: String(whole), usd: kesToUsd(whole, kesPerUsd).toFixed(2) }
}

export function pairFromUsd(usd: number, kesPerUsd: number): { kes: string; usd: string } {
  const clean = Math.max(0, Math.round(usd * 100) / 100)
  return { usd: clean.toFixed(2), kes: String(usdToKes(clean, kesPerUsd)) }
}

export function MoneyPair({
  kesValue,
  usdValue,
  kesPerUsd,
  onKes,
  onUsd,
  note,
  kesTestId,
  usdTestId,
}: {
  kesValue: string
  usdValue: string
  kesPerUsd: number
  onKes: (kes: string, usd: string) => void
  onUsd: (usd: string, kes: string) => void
  note: string
  kesTestId?: string
  usdTestId?: string
}) {
  return (
    <div className="space-y-2" data-testid="money-pair">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <Input
          label="Amount (KES)"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={kesValue}
          onChange={(event) => {
            const raw = event.target.value
            const n = Number(raw)
            onKes(raw, raw.trim() === '' || !Number.isFinite(n) ? '' : kesToUsd(n, kesPerUsd).toFixed(2))
          }}
          data-testid={kesTestId}
        />
        <span className="mb-3 font-mono text-sm text-mist" aria-hidden="true">
          =
        </span>
        <Input
          label="Amount (USD)"
          type="number"
          inputMode="decimal"
          min={0.01}
          step={0.01}
          value={usdValue}
          onChange={(event) => {
            const raw = event.target.value
            const n = Number(raw)
            onUsd(raw, raw.trim() === '' || !Number.isFinite(n) ? '' : String(usdToKes(n, kesPerUsd)))
          }}
          data-testid={usdTestId}
        />
      </div>
      <p className="text-xs text-mist">
        {rateLine(kesPerUsd)} · {note}
      </p>
    </div>
  )
}

export function PayBreakdown({
  amountUsd,
  kesPerUsd,
  note,
}: {
  amountUsd: number
  kesPerUsd: number
  note?: string
}) {
  const kes = usdToKes(amountUsd, kesPerUsd)
  return (
    <div className="rounded-xl border border-line bg-ink px-3 py-2 text-sm" data-testid="pay-breakdown">
      <div className="flex justify-between gap-3">
        <span className="text-mist">You pay (USD)</span>
        <span className="font-mono text-paper">{formatMoney(amountUsd)}</span>
      </div>
      <div className="mt-1 flex justify-between gap-3">
        <span className="text-mist">M-Pesa prompt (KES)</span>
        <span className="font-mono text-paper">{formatKes(kes)}</span>
      </div>
      <p className="mt-2 border-t border-line pt-2 text-xs text-mist">
        {rateLine(kesPerUsd)}
        {note ? ` · ${note}` : ''}
      </p>
    </div>
  )
}
