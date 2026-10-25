/** Pure MegaPay dual-account helpers (mirrors edge megapay-accounts.ts). */

export type MegapayAccountId = 'winsoft' | 'vast'

export interface MegapayAccount {
  id: MegapayAccountId
  label: string
  apiKey: string
  email: string
}

export function parseMegapayAccounts(env: Record<string, string | undefined>): MegapayAccount[] {
  const email = env.MEGAPAY_EMAIL?.trim() || ''
  const emailWinsoft = env.MEGAPAY_EMAIL_WINSOFT?.trim() || email
  const emailVast = env.MEGAPAY_EMAIL_VAST?.trim() || email
  const keyWinsoft =
    env.MEGAPAY_API_KEY_WINSOFT?.trim() || env.MEGAPAY_API_KEY?.trim() || ''
  const keyVast = env.MEGAPAY_API_KEY_VAST?.trim() || ''
  const accounts: MegapayAccount[] = []
  if (keyWinsoft && emailWinsoft) {
    accounts.push({
      id: 'winsoft',
      label: 'Winsoft',
      apiKey: keyWinsoft,
      email: emailWinsoft,
    })
  }
  if (keyVast && emailVast) {
    accounts.push({ id: 'vast', label: 'Vast', apiKey: keyVast, email: emailVast })
  }
  return accounts
}

export function nextMegapayAccountId(
  enabledIds: MegapayAccountId[],
  lastCursor: string | undefined | null,
): MegapayAccountId | null {
  if (enabledIds.length === 0) return null
  if (enabledIds.length === 1) return enabledIds[0]!
  const last: MegapayAccountId =
    lastCursor === 'vast' || lastCursor === 'b' ? 'vast' : 'winsoft'
  return enabledIds.find((id) => id !== last) ?? enabledIds[0]!
}

export function normalizeMegapayAccountId(value: unknown): MegapayAccountId {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'vast' || raw === 'b') return 'vast'
  return 'winsoft'
}
