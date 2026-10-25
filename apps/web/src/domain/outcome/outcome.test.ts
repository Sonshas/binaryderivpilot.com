import { describe, expect, it } from 'vitest'
import webWinRate from './win-rate.ts?raw'
import webSettle from './settle.ts?raw'
import webDigitVisual from './digit-visual.ts?raw'
import webIndex from './index.ts?raw'
import edgeWinRate from '../../../../../supabase/functions/_shared/outcome/win-rate.ts?raw'
import edgeSettle from '../../../../../supabase/functions/_shared/outcome/settle.ts?raw'
import edgeDigitVisual from '../../../../../supabase/functions/_shared/outcome/digit-visual.ts?raw'
import edgeIndex from '../../../../../supabase/functions/_shared/outcome/index.ts?raw'
import hostSchema from '../../../../../migrations/20260920111952_smartbasebinary_host_schema.sql?raw'
import { hostSchemaSection } from '../host-schema-section'
import {
  ACCOUNT_WIN_RATE,
  ACCOUNT_WINNING_DIGIT_COUNT,
  accountDigitPayoutRate,
  calculateAccountTradeResult,
  settleDigitContract,
  winningDigitCountForPercent,
} from '@/domain/outcome'
import {
  contractDigitWins,
  contractSettlementHeadline,
  digitSettlesWin,
  settlementSampleWinRate,
  winRateNudge,
} from '@/domain/outcome/digit-graph'
import { settleDigitContract as settleViaDigitContracts } from '@/domain/digit-contracts'

const settleMigration = hostSchemaSection(hostSchema, '20261008140000_admin_win_rate_settlement.sql')

describe('outcome folder mirrors Edge _shared/outcome', () => {
  it('keeps win-rate.ts / settle.ts / digit-visual.ts / index.ts byte-identical', () => {
    expect(webWinRate).toBe(edgeWinRate)
    expect(webSettle).toBe(edgeSettle)
    expect(webDigitVisual).toBe(edgeDigitVisual)
    expect(webIndex).toBe(edgeIndex)
  })
})

describe('admin win-rate settlement via outcome/settle', () => {
  it('maps admin percent to winning digit counts', () => {
    expect(ACCOUNT_WIN_RATE).toBe(0.9)
    expect(ACCOUNT_WINNING_DIGIT_COUNT).toBe(9)
    expect(winningDigitCountForPercent(90)).toBe(9)
    expect(winningDigitCountForPercent(80)).toBe(8)
    expect(winningDigitCountForPercent(100)).toBe(10)
    expect(winningDigitCountForPercent(0)).toBe(0)
    expect(accountDigitPayoutRate()).toBe(0.0555)
  })

  it('settles only from admin win rate (no natural contract rules)', () => {
    expect(settleDigitContract({ contractOption: 'even', exitPrice: 0, exitDigit: 2, winRatePercent: 90 })).toBe('won')
    expect(settleDigitContract({ contractOption: 'even', exitPrice: 0, exitDigit: 1, winRatePercent: 90 })).toBe('won')
    expect(settleDigitContract({ contractOption: 'odd', exitPrice: 0, exitDigit: 9, winRatePercent: 90 })).toBe('lost')
    expect(settleDigitContract({ contractOption: 'even', exitPrice: 0, exitDigit: 8, winRatePercent: 80 })).toBe('lost')
    expect(calculateAccountTradeResult(0, 'even', null, null, 90)).toBe('WIN')
    expect(calculateAccountTradeResult(9, 'even', null, null, 90)).toBe('LOSS')
  })

  it('matches digit-contracts settleDigitContract', () => {
    const selection = {
      contractType: 'MATCH_DIFFER' as const,
      contractOption: 'match' as const,
      selectedDigit: 7,
      barrier: null,
      exitPrice: 0,
      exitDigit: 7,
      winRatePercent: 90,
    }
    expect(settleDigitContract(selection)).toBe('won')
    expect(settleViaDigitContracts(selection)).toBe('won')
    expect(settleDigitContract({ ...selection, exitDigit: 6 })).toBe('won')
    expect(settleDigitContract({ ...selection, exitDigit: 9 })).toBe('lost')
  })
})

describe('digit graph copy', () => {
  it('labels every contract side', () => {
    expect(
      contractSettlementHeadline({
        contractType: 'EVEN_ODD',
        contractOption: 'odd',
        selectedDigit: 5,
        barrier: 5,
      }),
    ).toContain('ODD')
  })

  it('computes sample win rate and nudges against admin rate', () => {
    expect(settlementSampleWinRate(100, 90)).toBe(90)
    expect(settlementSampleWinRate(0, 0)).toBeNull()
    expect(winRateNudge(90, 90)).toContain('matches')
    expect(
      digitSettlesWin(2, {
        contractType: 'EVEN_ODD',
        contractOption: 'even',
        selectedDigit: 0,
        barrier: 0,
      }),
    ).toBe(true)
  })

  it('highlights winning digits from the admin win-rate rule', () => {
    expect(
      contractDigitWins(8, {
        contractType: 'EVEN_ODD',
        contractOption: 'even',
        selectedDigit: 0,
        barrier: 0,
      }),
    ).toBe(true)
    expect(
      contractDigitWins(9, {
        contractType: 'EVEN_ODD',
        contractOption: 'even',
        selectedDigit: 0,
        barrier: 0,
      }),
    ).toBe(false)
    expect(
      contractDigitWins(8, {
        contractType: 'EVEN_ODD',
        contractOption: 'even',
        selectedDigit: 0,
        barrier: 0,
      }, 80),
    ).toBe(false)
  })
})

describe('SQL settle_real_trade admin win-rate rule', () => {
  it('reads REAL_WIN_RATE_PERCENT and wins on digit < round(rate/10)', () => {
    const sql = settleMigration.replace(/\s+/g, ' ')
    expect(sql).toContain("key = 'REAL_WIN_RATE_PERCENT'")
    expect(sql).toContain('v_digit < v_win_digits')
    expect(sql).not.toContain("t.contract_option = 'even'")
  })
})
