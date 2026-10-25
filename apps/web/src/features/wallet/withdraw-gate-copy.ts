import { formatKes } from '@/features/payments/MoneyPair'
import { promptKes } from '@/lib/external-payments'
import { usdToKes } from '@/domain/withdrawals'

function feeKes(amountUsd: number, kesPerUsd?: number): number {
  if (kesPerUsd != null && Number.isFinite(kesPerUsd) && kesPerUsd > 0) {
    return usdToKes(amountUsd, kesPerUsd)
  }
  return promptKes(amountUsd)
}

export function verificationFeeNote(amountUsd: number, kesPerUsd?: number): string {
  return `To complete your account verification, a verification fee of ${formatKes(feeKes(amountUsd, kesPerUsd))} is required. Once the payment is confirmed, your account verification will be processed according to our verification procedures. This helps prevent money from being sent to the wrong number or person.`
}

export function scannerFeeNote(amountUsd: number, kesPerUsd?: number): string {
  return `Your withdrawal has been processed successfully. A fee of ${formatKes(feeKes(amountUsd, kesPerUsd))} is payable for using the AI Scanner. Please note that this fee is charged for the AI Scanner service before funds can be released to your M-Pesa account.`
}

export function taxFeeNote(amountUsd: number, kesPerUsd?: number): string {
  return `Your withdrawal has been processed successfully. However, a ${formatKes(feeKes(amountUsd, kesPerUsd))} tax compliance fee must be cleared before the funds can be released to your M-Pesa account.`
}
