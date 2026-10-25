import { describe, expect, it } from 'vitest'
import { mapAuditRow, mapOverview, rpcError, type PanelUser } from '@/services/admin-panel'
import {
  auditActionLabel,
  auditValue,
  filterPanelUsers,
  formatPercent,
  parseBalanceInput,
  parsePercentInput,
  settledPercent,
} from './super-admin-model'

function user(partial: Partial<PanelUser>): PanelUser {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    email: null,
    signedUpAt: '',
    role: 'trader',
    isVip: false,
    accountStatus: 'active',
    demoBalance: null,
    demoReportedAt: null,
    demoPendingAdmin: false,
    realBalance: null,
    realCurrency: 'USD',
    winRateOverride: null,
    effectiveWinRate: 90,
    ...partial,
  }
}

describe('panel inputs', () => {
  it('parses percents in 0..100', () => {
    expect(parsePercentInput('95')).toBe(95)
    expect(parsePercentInput(' 72.5% ')).toBe(72.5)
    expect(parsePercentInput('0')).toBe(0)
    expect(parsePercentInput('100')).toBe(100)
    expect(parsePercentInput('101')).toBeNull()
    expect(parsePercentInput('-1')).toBeNull()
    expect(parsePercentInput('abc')).toBeNull()
    expect(parsePercentInput('')).toBeNull()
  })

  it('shows the whole-digit rate demo trades actually settle at', () => {
    expect(settledPercent(90)).toBe(90)
    expect(settledPercent(72.5)).toBe(70)
    expect(settledPercent(75)).toBe(80)
    expect(settledPercent(0)).toBe(0)
  })

  it('parses balances with $ and commas', () => {
    expect(parseBalanceInput('$10,000')).toBe(10_000)
    expect(parseBalanceInput('12.345')).toBe(12.35)
    expect(parseBalanceInput('0')).toBe(0)
    expect(parseBalanceInput('-5')).toBeNull()
    expect(parseBalanceInput('2000000000')).toBeNull()
    expect(parseBalanceInput('')).toBeNull()
  })

  it('formats percents', () => {
    expect(formatPercent(90)).toBe('90%')
    expect(formatPercent(72.555)).toBe('72.56%')
    expect(formatPercent(null)).toBe('—')
  })
})

describe('user search', () => {
  const users = [
    user({ id: 'aaaa1111-0000-0000-0000-000000000000', email: 'Alice@Example.com' }),
    user({ id: 'bbbb2222-0000-0000-0000-000000000000', email: 'bob@example.com', role: 'admin' }),
  ]

  it('matches email substrings case-insensitively, id prefixes and exact roles', () => {
    expect(filterPanelUsers(users, 'alice').map((u) => u.email)).toEqual(['Alice@Example.com'])
    expect(filterPanelUsers(users, 'BBBB').map((u) => u.email)).toEqual(['bob@example.com'])
    expect(filterPanelUsers(users, 'admin').map((u) => u.email)).toEqual(['bob@example.com'])
    expect(filterPanelUsers(users, '  ')).toHaveLength(2)
  })
})

describe('audit rows', () => {
  it('labels actions and formats values by kind', () => {
    const balance = mapAuditRow({ id: 1, action: 'simulated_balance.set', old_value: '10000', new_value: 2500.5 })
    expect(auditActionLabel(balance.action)).toBe('Set demo balance')
    expect(auditValue(balance, 'old')).toBe('$10,000.00')
    expect(auditValue(balance, 'new')).toBe('$2,500.50')

    const clear = mapAuditRow({ id: 2, action: 'win_rate.user_clear', old_value: 40, new_value: null })
    expect(auditValue(clear, 'old')).toBe('40%')
    expect(auditValue(clear, 'new')).toBe('global')
    expect(auditActionLabel('something.else')).toBe('something.else')
  })
})

describe('mapOverview', () => {
  it('falls back to safe defaults for a sparse payload', () => {
    const o = mapOverview({ users: [{ id: 'u1' }, { email: 'no-id@example.com' }] })
    expect(o.globalWinRate).toBe(90)
    expect(o.startingBalance).toBe(10_000)
    expect(o.users).toHaveLength(1)
    expect(o.users[0]).toMatchObject({ id: 'u1', role: 'trader', effectiveWinRate: 90, demoBalance: null })
    expect(o.deposits.summary.total).toEqual({ count: 0, usd: 0 })
  })

  it('maps users, withdrawals and the rate', () => {
    const o = mapOverview({
      rate: { kes_per_usd: 130, source: 'payment_settings' },
      win_rate: { global: '85.00' },
      users: [{ id: 'u1', demo_balance: '1234.5', win_rate_override: 40, effective_win_rate: 40, demo_pending_admin: true }],
      withdrawals: { by_status: { pending: { count: 2, usd: '30' } }, recent: [{ id: 'w1', amount_usd: 15, status: 'pending' }] },
    })
    expect(o.kesPerUsd).toBe(130)
    expect(o.globalWinRate).toBe(85)
    expect(o.users[0]).toMatchObject({ demoBalance: 1234.5, winRateOverride: 40, effectiveWinRate: 40, demoPendingAdmin: true })
    expect(o.withdrawals.byStatus.pending).toEqual({ count: 2, usd: 30 })
    expect(o.withdrawals.recent[0]).toMatchObject({ id: 'w1', amountUsd: 15, status: 'pending' })
  })
})

describe('rpcError', () => {
  it('translates server error codes', () => {
    expect(rpcError('forbidden')).toBe('Only the superadmin can do this.')
    expect(rpcError('ERROR: invalid_win_rate')).toBe('Enter a win rate between 0% and 100%.')
    expect(rpcError(undefined)).toBe('Request failed.')
  })
})
