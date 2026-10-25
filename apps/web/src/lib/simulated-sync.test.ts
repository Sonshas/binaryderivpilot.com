import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoWinRatePercent, nextSyncStep, readSeenVersion, setServerDemoWinRate, writeSeenVersion } from './simulated-sync'

describe('nextSyncStep', () => {
  it('does nothing when the server accepted the report', () => {
    expect(nextSyncStep({ balance: 500, admin_version: 3, accepted: true }, 3)).toEqual({ kind: 'done' })
    expect(nextSyncStep(null, 0)).toEqual({ kind: 'done' })
  })

  it('adopts a newer admin-set balance', () => {
    expect(nextSyncStep({ balance: 10_000, admin_version: 4, accepted: false }, 3)).toEqual({
      kind: 'adopt',
      target: 10_000,
      version: 4,
    })
    expect(nextSyncStep({ balance: 12.345, admin_version: 1, accepted: false }, 0)).toMatchObject({ target: 12.35 })
  })

  it('never adopts an already-applied version or an invalid balance', () => {
    expect(nextSyncStep({ balance: 10_000, admin_version: 3, accepted: false }, 3)).toEqual({ kind: 'done' })
    expect(nextSyncStep({ balance: -1, admin_version: 9, accepted: false }, 3)).toEqual({ kind: 'done' })
    expect(nextSyncStep({ balance: Number.NaN, admin_version: 9, accepted: false }, 3)).toEqual({ kind: 'done' })
  })
})

describe('seen admin version', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    })
  })
  afterEach(() => {
    store.clear()
    vi.unstubAllGlobals()
  })

  it('is stored per email, case-insensitively', () => {
    expect(readSeenVersion('A@x.com')).toBe(0)
    writeSeenVersion('A@x.com', 7)
    expect(readSeenVersion('a@x.com')).toBe(7)
    expect(readSeenVersion('b@x.com')).toBe(0)
  })
})

describe('demo win rate cache', () => {
  afterEach(() => setServerDemoWinRate(null))

  it('uses the fallback until the server rate arrives', () => {
    expect(demoWinRatePercent(90)).toBe(90)
    setServerDemoWinRate('60.00')
    expect(demoWinRatePercent(90)).toBe(60)
    setServerDemoWinRate(0)
    expect(demoWinRatePercent(90)).toBe(0)
  })

  it('ignores invalid server values', () => {
    setServerDemoWinRate(150)
    expect(demoWinRatePercent(90)).toBe(90)
    setServerDemoWinRate('nope')
    expect(demoWinRatePercent(90)).toBe(90)
  })
})
