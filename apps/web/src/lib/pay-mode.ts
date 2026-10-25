import { DEFAULT_DEPOSIT_PROVIDER, type DepositProvider } from '@/domain/daraja'
import { isPayMode } from '@/domain/payments/pay-mode'

const KEY = 'sbb.pay.mode'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readSavedPayMode(): DepositProvider | null {
  const raw = storage()?.getItem(KEY)
  return isPayMode(raw) ? (raw.trim().toLowerCase() as DepositProvider) : null
}

export function activePayMode(): DepositProvider {
  return readSavedPayMode() ?? DEFAULT_DEPOSIT_PROVIDER
}

export function savePayMode(mode: DepositProvider): DepositProvider {
  const next = isPayMode(mode) ? mode : DEFAULT_DEPOSIT_PROVIDER
  storage()?.setItem(KEY, next)
  return next
}

/** Cache server DEPOSIT_PROVIDER for offline/fallback reads. */
export function hydratePayMode(mode: DepositProvider): DepositProvider {
  return savePayMode(mode)
}
