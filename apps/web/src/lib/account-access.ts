const KEY = 'sbb.account.enabled'

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

function readAll(): Record<string, boolean> {
  if (!canUseStorage()) return {}
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, boolean>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function accountEnabled(email: string | null | undefined): boolean {
  const key = email?.trim().toLowerCase() ?? ''
  if (!key) return false
  return readAll()[key] !== false
}

export function setAccountEnabled(email: string, enabled: boolean): void {
  const key = email.trim().toLowerCase()
  if (!key || !canUseStorage()) return
  const next = readAll()
  next[key] = enabled
  localStorage.setItem(KEY, JSON.stringify(next))
}

export function rekeyAccountEmail(fromEmail: string, toEmail: string): void {
  const from = fromEmail.trim().toLowerCase()
  const to = toEmail.trim().toLowerCase()
  if (!from || !to || from === to || !canUseStorage()) return
  const next = readAll()
  if (!(from in next)) return
  next[to] = next[from]
  delete next[from]
  localStorage.setItem(KEY, JSON.stringify(next))
}
