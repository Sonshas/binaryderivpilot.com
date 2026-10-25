import { describe, expect, it } from 'vitest'
import {
  DIGIT_CONTRACT_KINDS,
  calculateTradeResult,
  contractCanWin,
  digitPayoutRate,
  payoutFor,
  selectionForKind,
  settleDigitContract as settleViaContracts,
  winningDigitCount,
  type DigitContractKind,
} from '@/domain/digit-contracts'
import {
  calculateAccountTradeResult,
  settleDigitContract as settleViaOutcome,
} from '@/domain/outcome'
import { contractDigitWins } from '@/domain/outcome/digit-graph'
import { settledResult } from '@/domain/trade-result'
import { STANDARD_PAYOUT_RATE } from '@/domain/digit-contracts'

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const

function expectedAccount(digit: number): 'WIN' | 'LOSS' {
  return digit >= 0 && digit <= 8 ? 'WIN' : 'LOSS'
}

function settleInput(kind: DigitContractKind, target: number | null, exitDigit: number) {
  const selection = selectionForKind(kind, target)
  return {
    ...selection,
    exitPrice: 0,
    exitDigit,
  }
}

describe('exhaustive outcome matrix — all trade types (admin 90%)', () => {
  it('covers every EVEN / ODD × exit digit 0–9 via account 90% rule', () => {
    for (const kind of ['EVEN', 'ODD'] as const) {
      for (const digit of DIGITS) {
        const want = expectedAccount(digit)
        const selection = selectionForKind(kind, null)
        expect(calculateTradeResult(kind, null, digit)).toBe(want)
        expect(calculateAccountTradeResult(digit, kind.toLowerCase())).toBe(want)
        expect(settleViaContracts(settleInput(kind, null, digit))).toBe(want === 'WIN' ? 'won' : 'lost')
        expect(settleViaOutcome(settleInput(kind, null, digit))).toBe(want === 'WIN' ? 'won' : 'lost')
        expect(
          settledResult({
            status: want === 'WIN' ? 'won' : 'lost',
            ...selection,
            exitDigit: digit,
          }),
        ).toBe(want)
        expect(
          contractDigitWins(digit, {
            contractType: selection.contractType,
            contractOption: selection.contractOption,
            selectedDigit: 0,
            barrier: 0,
          }),
        ).toBe(want === 'WIN')
      }
    }
  })

  it('covers every MATCH / DIFFER × target 0–9 × exit digit 0–9', () => {
    for (const kind of ['MATCH', 'DIFFER'] as const) {
      for (const target of DIGITS) {
        for (const digit of DIGITS) {
          const want = expectedAccount(digit)
          const selection = selectionForKind(kind, target)
          expect(calculateTradeResult(kind, target, digit)).toBe(want)
          expect(calculateAccountTradeResult(digit, kind.toLowerCase(), target, null)).toBe(want)
          expect(settleViaContracts(settleInput(kind, target, digit))).toBe(want === 'WIN' ? 'won' : 'lost')
          expect(settleViaOutcome(settleInput(kind, target, digit))).toBe(want === 'WIN' ? 'won' : 'lost')
          expect(
            settledResult({
              status: want === 'WIN' ? 'won' : 'lost',
              ...selection,
              exitDigit: digit,
            }),
          ).toBe(want)
          expect(
            contractDigitWins(digit, {
              contractType: selection.contractType,
              contractOption: selection.contractOption,
              selectedDigit: target,
              barrier: 0,
            }),
          ).toBe(want === 'WIN')
        }
      }
    }
  })

  it('covers every OVER / UNDER × barrier 0–9 × exit digit 0–9', () => {
    for (const kind of ['OVER', 'UNDER'] as const) {
      for (const barrier of DIGITS) {
        for (const digit of DIGITS) {
          const want = expectedAccount(digit)
          const selection = selectionForKind(kind, barrier)
          expect(calculateTradeResult(kind, barrier, digit)).toBe(want)
          expect(calculateAccountTradeResult(digit, kind.toLowerCase(), null, barrier)).toBe(want)
          expect(settleViaContracts(settleInput(kind, barrier, digit))).toBe(want === 'WIN' ? 'won' : 'lost')
          expect(settleViaOutcome(settleInput(kind, barrier, digit))).toBe(want === 'WIN' ? 'won' : 'lost')
          expect(
            settledResult({
              status: want === 'WIN' ? 'won' : 'lost',
              ...selection,
              exitDigit: digit,
            }),
          ).toBe(want)
          expect(
            contractDigitWins(digit, {
              contractType: selection.contractType,
              contractOption: selection.contractOption,
              selectedDigit: 0,
              barrier,
            }),
          ).toBe(want === 'WIN')
        }
      }
    }
  })

  it('reports 9 winning digits (90%) for every selectable contract', () => {
    expect(winningDigitCount(selectionForKind('EVEN', null))).toBe(9)
    expect(winningDigitCount(selectionForKind('ODD', null))).toBe(9)
    for (const target of DIGITS) {
      expect(winningDigitCount(selectionForKind('MATCH', target))).toBe(9)
      expect(winningDigitCount(selectionForKind('DIFFER', target))).toBe(9)
      if (target < 9) expect(winningDigitCount(selectionForKind('OVER', target))).toBe(9)
      if (target > 0) expect(winningDigitCount(selectionForKind('UNDER', target))).toBe(9)
    }
    expect(contractCanWin(selectionForKind('OVER', 9))).toBe(false)
    expect(contractCanWin(selectionForKind('UNDER', 0))).toBe(false)
    expect(digitPayoutRate(selectionForKind('OVER', 9))).toBe(0)
    expect(digitPayoutRate(selectionForKind('UNDER', 0))).toBe(0)
    expect(digitPayoutRate(selectionForKind('EVEN', null))).toBe(STANDARD_PAYOUT_RATE)
  })

  it('pays stake×(1+0.9522) on wins and 0 on losses for every kind', () => {
    const stake = 10
    const wonPayout = payoutFor(stake, STANDARD_PAYOUT_RATE, 'won')
    expect(wonPayout).toBe(19.52)
    for (const kind of DIGIT_CONTRACT_KINDS) {
      const target = kind === 'EVEN' || kind === 'ODD' ? null : 5
      for (const digit of DIGITS) {
        const want = expectedAccount(digit)
        const outcome = settleViaOutcome(settleInput(kind, target, digit))
        expect(outcome).toBe(want === 'WIN' ? 'won' : 'lost')
        expect(payoutFor(stake, STANDARD_PAYOUT_RATE, outcome)).toBe(want === 'WIN' ? wonPayout : 0)
      }
    }
  })

  it('falls back to last digit of exitPrice when exitDigit is missing', () => {
    const price = 1234.57 // last digit 7 → win under account rule
    expect(
      settleViaOutcome({
        contractType: 'EVEN_ODD',
        contractOption: 'odd',
        selectedDigit: null,
        barrier: null,
        exitPrice: price,
      }),
    ).toBe('won')
    expect(
      settleViaOutcome({
        contractType: 'EVEN_ODD',
        contractOption: 'even',
        selectedDigit: null,
        barrier: null,
        exitPrice: price,
      }),
    ).toBe('won')
    expect(
      settleViaOutcome({
        contractType: 'MATCH_DIFFER',
        contractOption: 'match',
        selectedDigit: 7,
        barrier: null,
        exitPrice: price,
      }),
    ).toBe('won')
    expect(
      settleViaOutcome({
        contractType: 'OVER_UNDER',
        contractOption: 'over',
        selectedDigit: null,
        barrier: 6,
        exitPrice: price,
      }),
    ).toBe('won')
    expect(
      settleViaContracts({
        contractType: 'MATCH_DIFFER',
        contractOption: 'differ',
        selectedDigit: 7,
        barrier: null,
        exitPrice: price,
      }),
    ).toBe('won')
  })

  it('rejects impossible OVER 9 / UNDER 0 as cannot-win selections', () => {
    expect(contractCanWin(selectionForKind('OVER', 9))).toBe(false)
    expect(contractCanWin(selectionForKind('UNDER', 0))).toBe(false)
  })
})
