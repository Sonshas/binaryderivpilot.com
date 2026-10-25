import { type DepositProvider } from './daraja.ts'

export interface PayMode {
  id: DepositProvider
  label: string
  detail: string
  envKeys: readonly string[]
}

export const PAY_MODES: readonly PayMode[] = [
  {
    id: 'daraja',
    label: 'Daraja',
    detail: 'Safaricom M-Pesa STK through a paybill.',
    envKeys: [
      'DEPOSIT_PROVIDER',
      'MPESA_CONSUMER_KEY',
      'MPESA_CONSUMER_SECRET',
      'MPESA_SHORTCODE',
      'MPESA_PASSKEY',
      'MPESA_CALLBACK_URL',
      'MPESA_ACCOUNT_REFERENCE',
    ],
  },
  {
    id: 'megapay',
    label: 'MegaPay',
    detail: 'MegaPay M-Pesa STK.',
    envKeys: [
      'DEPOSIT_PROVIDER',
      'MEGAPAY_API_KEY_WINSOFT',
      'MEGAPAY_API_KEY_VAST',
      'MEGAPAY_EMAIL',
    ],
  },
]

export function isPayMode(value: string | undefined | null): value is DepositProvider {
  const id = String(value ?? '').trim().toLowerCase()
  return PAY_MODES.some((mode) => mode.id === id)
}

export function payModeById(id: DepositProvider): PayMode {
  return PAY_MODES.find((mode) => mode.id === id) ?? PAY_MODES[0]!
}
