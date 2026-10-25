import { describe, expect, it } from 'vitest'
import { DIGIT_CONTRACT_KINDS, selectionForKind } from '@/domain/digit-contracts'
import { settleDigitContract } from '@/domain/outcome'
import { contractDigitWins, settlementSampleWinRate, winRateNudge } from '@/domain/outcome/digit-graph'

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const

describe('digit graph data-wins matches settlement for every trade type', () => {
  it.each([90, 80, 100, 50, 0] as const)(
    'at admin win rate %s%%, every EVEN/ODD/MATCH/DIFFER/OVER/UNDER digit matches settle',
    (winRatePercent) => {
      for (const kind of DIGIT_CONTRACT_KINDS) {
        const targets =
          kind === 'EVEN' || kind === 'ODD'
            ? [null]
            : kind === 'OVER'
              ? ([0, 1, 2, 3, 4, 5, 6, 7, 8] as const)
              : kind === 'UNDER'
                ? ([1, 2, 3, 4, 5, 6, 7, 8, 9] as const)
                : DIGITS
        for (const target of targets) {
          const selection = selectionForKind(kind, target)
          const ticket = {
            contractType: selection.contractType,
            contractOption: selection.contractOption,
            selectedDigit: selection.selectedDigit ?? 0,
            barrier: selection.barrier ?? 0,
          }
          for (const digit of DIGITS) {
            const graphWins = contractDigitWins(digit, ticket, winRatePercent)
            const settled = settleDigitContract({
              ...selection,
              exitPrice: 0,
              exitDigit: digit,
              winRatePercent,
            })
            expect(graphWins).toBe(settled === 'won')
          }
        }
      }
    },
  )

  it('sample nudge compares graph win share to admin win rate (not natural odds)', () => {
    const sample = DIGITS
    const wins = sample.filter((d) =>
      contractDigitWins(d, {
        contractType: 'EVEN_ODD',
        contractOption: 'odd',
        selectedDigit: 0,
        barrier: 0,
      }, 90),
    ).length
    const pct = settlementSampleWinRate(sample.length, wins)
    expect(pct).toBe(90)
    expect(winRateNudge(pct, 90)).toContain('matches')
    expect(winRateNudge(50, 90)).toContain('below')
    expect(winRateNudge(100, 90)).toContain('above')
  })
})
