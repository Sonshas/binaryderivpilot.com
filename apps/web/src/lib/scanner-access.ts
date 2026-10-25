import { currentRealEmail } from '@/lib/real-books'

const ACCESS_KEY = 'sbb.ai.scanner'

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

function readPaid(): Record<string, string> {
  if (!canUseStorage()) return {}
  try {
    const raw = localStorage.getItem(ACCESS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function scannerPaid(email?: string | null): boolean {
  const key = (email ?? currentRealEmail()).trim().toLowerCase()
  if (!key) return false
  return Boolean(readPaid()[key])
}

export function markScannerPaid(email?: string | null): void {
  const key = (email ?? currentRealEmail()).trim().toLowerCase()
  if (!key || !canUseStorage()) return
  const paid = readPaid()
  paid[key] = new Date().toISOString()
  localStorage.setItem(ACCESS_KEY, JSON.stringify(paid))
}

export function rekeyScannerEmail(fromEmail: string, toEmail: string): void {
  const from = fromEmail.trim().toLowerCase()
  const to = toEmail.trim().toLowerCase()
  if (!from || !to || from === to || !canUseStorage()) return
  const paid = readPaid()
  if (!paid[from]) return
  paid[to] = paid[from]
  delete paid[from]
  localStorage.setItem(ACCESS_KEY, JSON.stringify(paid))
}
