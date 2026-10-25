/** Dual MegaPay merchant accounts with round-robin selection (TradeWise-style alternation). */

export type MegapayAccountId = 'winsoft' | 'vast'

export interface MegapayAccount {
  id: MegapayAccountId
  label: string
  apiKey: string
  email: string
}

export interface MegapayAccountPublic {
  id: MegapayAccountId
  label: string
  enabled: boolean
  configured: boolean
  emailHint: string | null
  keyHint: string | null
}

export const MEGAPAY_ACCOUNT_WINSOFT_ENABLED = 'MEGAPAY_ACCOUNT_WINSOFT_ENABLED'
export const MEGAPAY_ACCOUNT_VAST_ENABLED = 'MEGAPAY_ACCOUNT_VAST_ENABLED'
export const MEGAPAY_RR_CURSOR = 'MEGAPAY_RR_CURSOR'

const ACCOUNT_ORDER: MegapayAccountId[] = ['winsoft', 'vast']

function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!user || !domain) return '***'
  const head = user.slice(0, 1)
  return `${head}***@${domain}`
}

function maskKey(key: string): string {
  if (key.length <= 4) return '****'
  return `…${key.slice(-4)}`
}

export function parseMegapayAccounts(env: Record<string, string | undefined>): MegapayAccount[] {
  const email = env.MEGAPAY_EMAIL?.trim() || ''
  const emailWinsoft = env.MEGAPAY_EMAIL_WINSOFT?.trim() || email
  const emailVast = env.MEGAPAY_EMAIL_VAST?.trim() || email
  // Prefer named keys; fall back to legacy MEGAPAY_API_KEY → winsoft.
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

export function boolSetting(map: Record<string, string>, key: string, fallback: boolean): boolean {
  const raw = map[key]
  if (raw == null || raw === '') return fallback
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false
  return fallback
}

export function accountEnabledInMap(map: Record<string, string>, id: MegapayAccountId): boolean {
  const key = id === 'winsoft' ? MEGAPAY_ACCOUNT_WINSOFT_ENABLED : MEGAPAY_ACCOUNT_VAST_ENABLED
  return boolSetting(map, key, true)
}

/** Pick the other account when both are on (alternate). Single enabled → that one. */
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

export function publicMegapayAccounts(
  accounts: MegapayAccount[],
  map: Record<string, string>,
): MegapayAccountPublic[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  return ACCOUNT_ORDER.map((id) => {
    const acct = byId.get(id)
    return {
      id,
      label: id === 'winsoft' ? 'Winsoft' : 'Vast',
      enabled: accountEnabledInMap(map, id),
      configured: Boolean(acct),
      emailHint: acct ? maskEmail(acct.email) : null,
      keyHint: acct ? maskKey(acct.apiKey) : null,
    }
  })
}

export function enabledSettingKey(id: MegapayAccountId): string {
  return id === 'winsoft' ? MEGAPAY_ACCOUNT_WINSOFT_ENABLED : MEGAPAY_ACCOUNT_VAST_ENABLED
}
