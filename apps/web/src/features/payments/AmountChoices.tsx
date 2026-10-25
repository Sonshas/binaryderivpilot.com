import { Button } from '@/components/ui'
import { pairFromUsd } from '@/features/payments/MoneyPair'

export const DEPOSIT_AMOUNTS = [20, 50, 100, 200, 500, 1000]
export const WITHDRAW_AMOUNTS = [20, 50, 100, 200, 500, 1000]

function amountLabel(usd: number): string {
  return usd >= 1000 ? `$${usd.toLocaleString('en-US')}` : `$${usd}`
}

export function AmountChoices({
  amounts,
  selectedUsd,
  kesPerUsd,
  onPick,
  isDisabled,
  testId = 'amount-choices',
}: {
  amounts: number[]
  selectedUsd: string
  kesPerUsd: number
  onPick: (usd: string, kes: string) => void
  isDisabled?: (usd: number) => boolean
  testId?: string
}) {
  return (
    <div className="grid grid-cols-3 gap-2" data-testid={testId}>
      {amounts.map((usd) => {
        const pair = pairFromUsd(usd, kesPerUsd)
        const disabled = isDisabled?.(usd) ?? false
        return (
          <Button
            key={usd}
            type="button"
            variant={selectedUsd === pair.usd ? 'primary' : 'secondary'}
            className="h-12 w-full px-2"
            disabled={disabled}
            onClick={() => onPick(pair.usd, pair.kes)}
          >
            {amountLabel(usd)}
          </Button>
        )
      })}
    </div>
  )
}
