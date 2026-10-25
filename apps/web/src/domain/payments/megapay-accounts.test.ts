import { describe, expect, it } from 'vitest'
import {
  nextMegapayAccountId,
  normalizeMegapayAccountId,
  parseMegapayAccounts,
} from './megapay-accounts'

describe('parseMegapayAccounts', () => {
  it('loads Winsoft and Vast from named keys with shared email', () => {
    const accounts = parseMegapayAccounts({
      MEGAPAY_API_KEY_WINSOFT: 'win-key',
      MEGAPAY_API_KEY_VAST: 'vast-key',
      MEGAPAY_EMAIL: 'pay@example.com',
    })
    expect(accounts).toEqual([
      { id: 'winsoft', label: 'Winsoft', apiKey: 'win-key', email: 'pay@example.com' },
      { id: 'vast', label: 'Vast', apiKey: 'vast-key', email: 'pay@example.com' },
    ])
  })

  it('falls back legacy MEGAPAY_API_KEY to Winsoft only', () => {
    const accounts = parseMegapayAccounts({
      MEGAPAY_API_KEY: 'legacy',
      MEGAPAY_EMAIL: 'pay@example.com',
    })
    expect(accounts).toEqual([
      { id: 'winsoft', label: 'Winsoft', apiKey: 'legacy', email: 'pay@example.com' },
    ])
  })

  it('prefers named Winsoft over legacy', () => {
    const accounts = parseMegapayAccounts({
      MEGAPAY_API_KEY: 'legacy',
      MEGAPAY_API_KEY_WINSOFT: 'named',
      MEGAPAY_EMAIL: 'pay@example.com',
    })
    expect(accounts[0]?.apiKey).toBe('named')
  })
})

describe('nextMegapayAccountId', () => {
  it('returns null when none enabled', () => {
    expect(nextMegapayAccountId([], null)).toBeNull()
  })

  it('returns the only enabled account', () => {
    expect(nextMegapayAccountId(['vast'], 'winsoft')).toBe('vast')
  })

  it('alternates Winsoft and Vast', () => {
    expect(nextMegapayAccountId(['winsoft', 'vast'], null)).toBe('vast')
    expect(nextMegapayAccountId(['winsoft', 'vast'], 'winsoft')).toBe('vast')
    expect(nextMegapayAccountId(['winsoft', 'vast'], 'vast')).toBe('winsoft')
    expect(nextMegapayAccountId(['winsoft', 'vast'], 'b')).toBe('winsoft')
  })
})

describe('normalizeMegapayAccountId', () => {
  it('maps legacy a/b and named ids', () => {
    expect(normalizeMegapayAccountId('winsoft')).toBe('winsoft')
    expect(normalizeMegapayAccountId('vast')).toBe('vast')
    expect(normalizeMegapayAccountId('b')).toBe('vast')
    expect(normalizeMegapayAccountId('a')).toBe('winsoft')
    expect(normalizeMegapayAccountId(undefined)).toBe('winsoft')
  })
})
