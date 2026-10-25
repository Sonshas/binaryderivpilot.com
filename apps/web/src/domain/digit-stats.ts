import { lastDigitOfPrice } from '@/domain/contracts'
import {
  countSettlementOutcomes,
  settlementLossCount,
  settlementWinCount,
} from '@/domain/outcome'
import { extractLastDigit } from '@/providers/market-data/deriv-digits'
import type { Tick } from '@/types'

export type DigitStats = {
  window: number
  sampleSize: number
  counts: number[]
  percentages: number[]
  evenCount: number
  oddCount: number
  overCount: number
  underCount: number
  equalCount: number
  evenPct: number
  oddPct: number
  overPct: number
  underPct: number
  equalPct: number
  barrier: number
  lastDigit: number | null
  mostFrequent: number | null
  leastFrequent: number | null
  settlementWinCount: number
  settlementLossCount: number
  contractWinCount: number
  contractLossCount: number
}

export function digitOfTick(tick: Tick): number | null {
  if (tick.lastDigit != null && Number.isInteger(tick.lastDigit)) return tick.lastDigit
  if (tick.pipSize != null) {
    const digit = extractLastDigit(tick.price, tick.pipSize)
    if (digit != null) return digit
  }
  return Number.isFinite(tick.price) ? lastDigitOfPrice(tick.price) : null
}

export function digitsFromTicks(ticks: Tick[]): number[] {
  const digits: number[] = []
  for (const tick of ticks) {
    if (tick.isSimulated) continue
    const digit = digitOfTick(tick)
    if (digit != null) digits.push(digit)
  }
  return digits
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 10_000) / 100
}

export function computeDigitStats(
  digits: number[],
  window = 100,
  barrier = 5,
  contractOption: 'even' | 'odd' | 'match' | 'differ' | 'over' | 'under' = 'even',
  selectedDigit: number | null = null,
): DigitStats {
  const sample = window > 0 ? digits.slice(-window) : digits
  const counts = Array.from({ length: 10 }, () => 0)
  let even = 0
  let over = 0
  let under = 0
  let equal = 0
  const valid: number[] = []
  for (const digit of sample) {
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) continue
    counts[digit]! += 1
    valid.push(digit)
    if (digit % 2 === 0) even += 1
    if (digit > barrier) over += 1
    else if (digit < barrier) under += 1
    else equal += 1
  }
  const total = counts.reduce((sum, value) => sum + value, 0)
  let mostFrequent: number | null = null
  let leastFrequent: number | null = null
  if (total > 0) {
    mostFrequent = 0
    leastFrequent = 0
    for (let digit = 1; digit < 10; digit += 1) {
      if (counts[digit]! > counts[mostFrequent]!) mostFrequent = digit
      if (counts[digit]! < counts[leastFrequent]!) leastFrequent = digit
    }
  }
  const contract = countSettlementOutcomes(valid, contractOption, selectedDigit, barrier)
  return {
    window,
    sampleSize: total,
    counts,
    percentages: counts.map((count) => pct(count, total)),
    evenCount: even,
    oddCount: total - even,
    overCount: over,
    underCount: under,
    equalCount: equal,
    evenPct: pct(even, total),
    oddPct: pct(total - even, total),
    overPct: pct(over, total),
    underPct: pct(under, total),
    equalPct: pct(equal, total),
    barrier,
    lastDigit: sample.length > 0 ? sample[sample.length - 1]! : null,
    mostFrequent,
    leastFrequent,
    settlementWinCount: settlementWinCount(valid),
    settlementLossCount: settlementLossCount(valid),
    contractWinCount: contract.wins,
    contractLossCount: contract.losses,
  }
}

export function currentParityStreak(digits: number[]): { parity: 'even' | 'odd' | null; length: number } {
  if (digits.length === 0) return { parity: null, length: 0 }
  const last = digits[digits.length - 1]!
  const parity = last % 2 === 0 ? 'even' : 'odd'
  let length = 0
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    if ((digits[i]! % 2 === 0 ? 'even' : 'odd') !== parity) break
    length += 1
  }
  return { parity, length }
}
