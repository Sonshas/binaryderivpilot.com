import { describe, expect, it } from 'vitest'
import { settleDigitContract as settleViaContracts } from '@/domain/digit-contracts'
import {
  calculateAccountTradeResult,
  settleDigitContract as settleViaOutcome,
} from '@/domain/outcome'
import { contractDigitWins } from '@/domain/outcome/digit-graph'
import { settledResult } from '@/domain/trade-result'

describe('outcome wired into trade settlement', () => {
  it('digit-contracts settleDigitContract uses admin 90% account rule (0–8 win)', () => {
    const cases = [
      { contractType: 'EVEN_ODD' as const, contractOption: 'even' as const, selectedDigit: null, barrier: null, exitDigit: 4, expect: 'won' as const },
      { contractType: 'EVEN_ODD' as const, contractOption: 'even' as const, selectedDigit: null, barrier: null, exitDigit: 9, expect: 'lost' as const },
      { contractType: 'EVEN_ODD' as const, contractOption: 'odd' as const, selectedDigit: null, barrier: null, exitDigit: 9, expect: 'lost' as const },
      { contractType: 'MATCH_DIFFER' as const, contractOption: 'match' as const, selectedDigit: 7, barrier: null, exitDigit: 7, expect: 'won' as const },
      { contractType: 'MATCH_DIFFER' as const, contractOption: 'match' as const, selectedDigit: 7, barrier: null, exitDigit: 6, expect: 'won' as const },
      { contractType: 'MATCH_DIFFER' as const, contractOption: 'differ' as const, selectedDigit: 7, barrier: null, exitDigit: 9, expect: 'lost' as const },
      { contractType: 'OVER_UNDER' as const, contractOption: 'over' as const, selectedDigit: null, barrier: 5, exitDigit: 3, expect: 'won' as const },
      { contractType: 'OVER_UNDER' as const, contractOption: 'under' as const, selectedDigit: null, barrier: 5, exitDigit: 9, expect: 'lost' as const },
    ]
    for (const row of cases) {
      const input = {
        contractType: row.contractType,
        contractOption: row.contractOption,
        selectedDigit: row.selectedDigit,
        barrier: row.barrier,
        exitPrice: 0,
        exitDigit: row.exitDigit,
      }
      expect(settleViaContracts(input)).toBe(row.expect)
      expect(settleViaOutcome(input)).toBe(row.expect)
      expect(settleViaContracts(input)).toBe(settleViaOutcome(input))
    }
  })

  it('settledResult uses account WIN/LOSS for trade history on the trade page', () => {
    expect(
      settledResult({
        status: 'won',
        contractType: 'EVEN_ODD',
        contractOption: 'odd',
        selectedDigit: null,
        barrier: null,
        exitDigit: 9,
      }),
    ).toBe('LOSS')
    expect(
      settledResult({
        status: 'lost',
        contractType: 'OVER_UNDER',
        contractOption: 'over',
        selectedDigit: null,
        barrier: 0,
        exitDigit: 0,
      }),
    ).toBe('WIN')
    expect(calculateAccountTradeResult(9, 'odd')).toBe('LOSS')
    expect(calculateAccountTradeResult(0, 'over', null, 0)).toBe('WIN')
  })

  it('DigitRow win highlighting matches account 90% (0–8 win, 9 lose)', () => {
    const ticket = {
      contractType: 'EVEN_ODD' as const,
      contractOption: 'even' as const,
      selectedDigit: 5,
      barrier: 5,
    }
    expect(contractDigitWins(2, ticket)).toBe(true)
    expect(contractDigitWins(9, ticket)).toBe(false)
    expect(contractDigitWins(9, { ...ticket, contractOption: 'odd' })).toBe(false)
    expect(
      contractDigitWins(7, {
        contractType: 'MATCH_DIFFER',
        contractOption: 'match',
        selectedDigit: 3,
        barrier: 5,
      }),
    ).toBe(true)
  })
})
