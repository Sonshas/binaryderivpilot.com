export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`
  return digits
}

export function phonesMatch(left: string, right: string): boolean {
  const a = normalizePhone(left)
  const b = normalizePhone(right)
  return a.length > 0 && a === b
}

export function parseLoginId(raw: string): { email: string } | { phone: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.includes('@')) {
    const email = normalizeEmail(trimmed)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
    return { email }
  }
  const phone = normalizePhone(trimmed)
  if (phone.length < 6) return null
  return { phone }
}
