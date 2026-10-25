import { beforeEach, describe, expect, it, vi } from 'vitest'

const memoryStore = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memoryStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStore.set(key, String(value))
  },
  removeItem: (key: string) => {
    memoryStore.delete(key)
  },
  clear: () => memoryStore.clear(),
  key: (index: number) => [...memoryStore.keys()][index] ?? null,
  get length() {
    return memoryStore.size
  },
})

const {
  clearUserWithdrawSteps,
  hasIncompleteWithdrawGates,
  saveExternalPayments,
  setUserWithdrawStep,
  externalPaid,
  hydrateExternalPayments,
  hydrateGatePaidFromServer,
  readExternalPayments,
  syncUserWithdrawStepsFromServer,
  syncWithdrawGatesClearedFromServer,
  userWithdrawStep,
  withdrawGatesCleared,
  withdrawStepOn,
} = await import('@/lib/external-payments')

describe('withdrawGatesCleared', () => {
  beforeEach(() => {
    memoryStore.clear()
    saveExternalPayments({
      verificationEnabled: true,
      scannerEnabled: true,
      taxEnabled: true,
      scannerUsd: 50,
      verificationUsd: 10,
      taxUsd: 67,
    })
  })

  it('is true when admin disables all three steps globally', () => {
    saveExternalPayments({
      verificationEnabled: false,
      scannerEnabled: false,
      taxEnabled: false,
    })
    expect(hasIncompleteWithdrawGates('a@b.com', false)).toBe(false)
    expect(withdrawGatesCleared('a@b.com', false)).toBe(true)
  })

  it('is true when all three steps are turned off for that member', () => {
    setUserWithdrawStep('a@b.com', 'verification', false)
    setUserWithdrawStep('a@b.com', 'scanner', false)
    setUserWithdrawStep('a@b.com', 'tax', false)
    expect(withdrawGatesCleared('a@b.com', false)).toBe(true)
    clearUserWithdrawSteps('a@b.com')
  })

  it('syncs server overrides into local storage (null clears)', () => {
    syncUserWithdrawStepsFromServer('a@b.com', {
      verification: false,
      scanner: false,
      tax: false,
    })
    expect(userWithdrawStep('a@b.com', 'verification')).toBe(false)
    expect(withdrawGatesCleared('a@b.com', false)).toBe(true)
    syncUserWithdrawStepsFromServer('a@b.com', {
      verification: null,
      scanner: null,
      tax: null,
    })
    expect(userWithdrawStep('a@b.com', 'verification')).toBe(null)
    expect(withdrawGatesCleared('a@b.com', false)).toBe(false)
  })

  it('treats staff withdraw_gates_cleared as done', () => {
    expect(withdrawGatesCleared('a@b.com', false)).toBe(false)
    syncWithdrawGatesClearedFromServer('a@b.com', true)
    expect(withdrawGatesCleared('a@b.com', false)).toBe(true)
    syncWithdrawGatesClearedFromServer('a@b.com', false)
    expect(withdrawGatesCleared('a@b.com', false)).toBe(false)
  })

  it('hydrates global withdraw controls from server payload', () => {
    hydrateExternalPayments({
      verificationEnabled: false,
      scannerEnabled: false,
      taxEnabled: false,
      scannerUsd: 40,
    })
    expect(readExternalPayments().scannerUsd).toBe(40)
    expect(withdrawStepOn('verification', 'a@b.com')).toBe(false)
    hydrateGatePaidFromServer({ verification: true, tax: true }, 'a@b.com')
    expect(externalPaid('verification', 'a@b.com')).toBe(true)
    expect(externalPaid('tax', 'a@b.com')).toBe(true)
  })

  it('admin fee edits replace prior local cache system-wide on hydrate', () => {
    saveExternalPayments({ scannerUsd: 50, verificationUsd: 10, taxUsd: 20 })
    expect(readExternalPayments().scannerUsd).toBe(50)
    hydrateExternalPayments({
      scannerUsd: 200.39,
      verificationUsd: 200.92,
      taxUsd: 150,
      defaultKesPerUsd: 130,
    })
    const next = readExternalPayments()
    expect(next.scannerUsd).toBe(200.39)
    expect(next.verificationUsd).toBe(200.92)
    expect(next.taxUsd).toBe(150)
    expect(next.defaultKesPerUsd).toBe(130)
  })
})
