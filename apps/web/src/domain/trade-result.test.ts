import { describe, expect, it } from 'vitest'
import hostSchema from '../../../../migrations/20260920111952_smartbasebinary_host_schema.sql?raw'
import { hostSchemaSection } from './host-schema-section'
import {
  DIGIT_CONTRACT_KINDS,
  calculateTradeResult,
  selectionForKind,
  settleDigitContract,
  type DigitContractKind,
} from '@/domain/digit-contracts'
import { settledResult } from '@/domain/trade-result'

const settleMigration = hostSchemaSection(hostSchema, '20261008140000_admin_win_rate_settlement.sql')

function expectedAccount(_kind: DigitContractKind, _target: number, digit: number): 'WIN' | 'LOSS' {
  return digit >= 0 && digit <= 8 ? 'WIN' : 'LOSS'
}

describe('calculateTradeResult (admin 90% account rule)', () => {
  it('wins on digits 0–8 and loses on 9 for every contract', () => {
    for (const kind of DIGIT_CONTRACT_KINDS) {
      for (let target = 0; target <= 9; target += 1) {
        for (let digit = 0; digit <= 9; digit += 1) {
          expect(calculateTradeResult(kind, target, digit)).toBe(expectedAccount(kind, target, digit))
        }
      }
    }
  })
})

describe('settleDigitContract (admin 90% account outcome)', () => {
  it('uses digits 0–8 won / 9 lost for every trade type', () => {
    for (const kind of DIGIT_CONTRACT_KINDS) {
      for (let target = 0; target <= 9; target += 1) {
        const selection = selectionForKind(kind, target)
        for (let digit = 0; digit <= 9; digit += 1) {
          const outcome = settleDigitContract({ ...selection, exitPrice: 0, exitDigit: digit })
          expect(outcome).toBe(expectedAccount(kind, target, digit) === 'WIN' ? 'won' : 'lost')
        }
      }
    }
  })
})

describe('settledResult', () => {
  it('uses the account 90% rule on the exit digit', () => {
    expect(
      settledResult({
        status: 'won',
        contractType: 'EVEN_ODD',
        contractOption: 'even',
        selectedDigit: null,
        barrier: null,
        exitDigit: 2,
      }),
    ).toBe('WIN')
    expect(
      settledResult({
        status: 'lost',
        contractType: 'EVEN_ODD',
        contractOption: 'even',
        selectedDigit: null,
        barrier: null,
        exitDigit: 9,
      }),
    ).toBe('LOSS')
    expect(
      settledResult({
        status: 'won',
        contractType: 'MATCH_DIFFER',
        contractOption: 'match',
        selectedDigit: 7,
        barrier: null,
        exitDigit: 3,
      }),
    ).toBe('WIN')
  })
})

describe('SQL settle_real_trade rule', () => {
  it('uses admin REAL_WIN_RATE_PERCENT (no natural contract branches)', () => {
    const sql = settleMigration.replace(/\s+/g, ' ')
    expect(sql).toContain("key = 'REAL_WIN_RATE_PERCENT'")
    expect(sql).toContain('v_digit < v_win_digits')
    expect(sql).not.toContain("t.contract_option = 'even'")
  })
})
