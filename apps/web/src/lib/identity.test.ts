import { describe, expect, it } from 'vitest'
import { normalizeEmail, normalizePhone, parseLoginId, phonesMatch } from '@/lib/identity'

describe('account identity', () => {
  it('treats email case and spacing as the same address', () => {
    expect(normalizeEmail('  George@SmartBaseBinary.com ')).toBe('george@smartbasebinary.com')
  })

  it('treats Kenyan local and international numbers as the same phone', () => {
    expect(normalizePhone('0712 345 678')).toBe('254712345678')
    expect(normalizePhone('+254712345678')).toBe('254712345678')
    expect(phonesMatch('0712345678', '254712345678')).toBe(true)
  })

  it('keeps other countries distinct', () => {
    expect(normalizePhone('+1 555 000 1111')).toBe('15550001111')
    expect(phonesMatch('+15550001111', '0712345678')).toBe(false)
    expect(phonesMatch('', '0712345678')).toBe(false)
  })

  it('accepts an email or a phone as a login id', () => {
    expect(parseLoginId('  George@SmartBaseBinary.com ')).toEqual({ email: 'george@smartbasebinary.com' })
    expect(parseLoginId('0712 345 678')).toEqual({ phone: '254712345678' })
    expect(parseLoginId('+254712345678')).toEqual({ phone: '254712345678' })
    expect(parseLoginId('not-an-email')).toBeNull()
    expect(parseLoginId('12')).toBeNull()
  })
})
