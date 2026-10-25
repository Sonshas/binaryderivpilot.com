import {
  countSettlementOutcomes,
  settlementLossCount,
  settlementWinCount,
} from '@/domain/outcome'
import type { ContractOption, ContractType } from '@/types'

export const SCANNER_DISCLAIMER =
  'Based on past ticks; digits are random and past frequency does not predict the next tick.'

export const AI_SCANNER_NOTE =
  'Ranks volatilities by recent tick patterns for the selected contract (counts only). Past ticks do not predict the next tick.'

export const AI_SCANNER_SAMPLES = [100, 500, 1000] as const

export interface DigitScan {
  sampleSize: number
  ranked: Array<{ digit: number; count: number }>
  hottest: number[]
  coldest: number[]
  evenCount: number
  oddCount: number
  barrier: number
  overCount: number
  underCount: number
  equalCount: number
  settlementWinCount: number
  settlementLossCount: number
  contractWinCount: number
  contractLossCount: number
}

export type ScanSettlement = {
  contractOption?: ContractOption
  selectedDigit?: number | null
  barrier?: number | null
  winRatePercent?: number
}

export function scanDigits(
  digits: readonly number[],
  window: number,
  barrier = 5,
  settlement: ScanSettlement = {},
): DigitScan {
  const sample = window > 0 ? digits.slice(-window) : [...digits]
  const counts = Array.from({ length: 10 }, () => 0)
  let even = 0
  let over = 0
  let under = 0
  let equal = 0
  let total = 0
  const valid: number[] = []
  for (const digit of sample) {
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) continue
    counts[digit]! += 1
    total += 1
    valid.push(digit)
    if (digit % 2 === 0) even += 1
    if (digit > barrier) over += 1
    else if (digit < barrier) under += 1
    else equal += 1
  }
  const ranked = counts
    .map((count, digit) => ({ digit, count }))
    .sort((a, b) => b.count - a.count || a.digit - b.digit)
  const max = total > 0 ? ranked[0]!.count : 0
  const min = total > 0 ? ranked[ranked.length - 1]!.count : 0
  const option = settlement.contractOption ?? 'even'
  const selectedDigit = settlement.selectedDigit ?? null
  const settleBarrier = settlement.barrier ?? barrier
  const contract = countSettlementOutcomes(valid, option, selectedDigit, settleBarrier, settlement.winRatePercent)
  const settleWins = settlementWinCount(valid, settlement.winRatePercent)
  const settleLosses = settlementLossCount(valid, settlement.winRatePercent)
  return {
    sampleSize: total,
    ranked,
    hottest: total > 0 ? ranked.filter((item) => item.count === max).map((item) => item.digit) : [],
    coldest:
      total > 0
        ? ranked
            .filter((item) => item.count === min)
            .map((item) => item.digit)
            .sort((a, b) => a - b)
        : [],
    evenCount: even,
    oddCount: total - even,
    barrier,
    overCount: over,
    underCount: under,
    equalCount: equal,
    settlementWinCount: settleWins,
    settlementLossCount: settleLosses,
    contractWinCount: contract.wins,
    contractLossCount: contract.losses,
  }
}

export function describeScan(scan: DigitScan): string {
  if (scan.sampleSize === 0) return 'No ticks yet'
  const hot = scan.hottest.map((d) => `${d} (${scan.ranked.find((r) => r.digit === d)!.count})`).join(', ')
  const cold = scan.coldest.map((d) => `${d} (${scan.ranked.find((r) => r.digit === d)!.count})`).join(', ')
  return `Most frequent ${hot} · Least frequent ${cold} · ${scan.sampleSize} ticks`
}

export interface ScannerPick {
  symbol: string
  contractType: ContractType
  contractOption: ContractOption
  selectedDigit: number | null
  barrier: number | null
  hits: number
  expected: number
  sampleSize: number
  deviation: number
  countsLine: string
}

interface Candidate {
  contractOption: ContractOption
  selectedDigit: number | null
  barrier: number | null
  hits: number
  p: number
}

function deviationOf(hits: number, n: number, p: number): number {
  const sd = Math.sqrt(n * p * (1 - p))
  return sd > 0 ? (hits - n * p) / sd : 0
}

function sumCounts(counts: number[], from: number, toExclusive: number): number {
  let total = 0
  for (let d = from; d < toExclusive; d += 1) total += counts[d] ?? 0
  return total
}

function candidatesFor(contractType: ContractType, counts: number[], n: number): Candidate[] {
  if (contractType === 'EVEN_ODD') {
    const even = (counts[0] ?? 0) + (counts[2] ?? 0) + (counts[4] ?? 0) + (counts[6] ?? 0) + (counts[8] ?? 0)
    const odd = n - even
    return [
      { contractOption: 'even', selectedDigit: null, barrier: null, hits: even, p: 0.5 },
      { contractOption: 'odd', selectedDigit: null, barrier: null, hits: odd, p: 0.5 },
    ]
  }
  if (contractType === 'OVER_UNDER') {
    const out: Candidate[] = []
    for (let b = 0; b <= 9; b += 1) {
      const under = sumCounts(counts, 0, b)
      const over = n - under - counts[b]!
      if (b <= 8) out.push({ contractOption: 'over', selectedDigit: null, barrier: b, hits: over, p: (9 - b) / 10 })
      if (b >= 1) out.push({ contractOption: 'under', selectedDigit: null, barrier: b, hits: under, p: b / 10 })
    }
    return out
  }
  const out: Candidate[] = []
  for (let d = 0; d <= 9; d += 1) {
    out.push({ contractOption: 'match', selectedDigit: d, barrier: null, hits: counts[d]!, p: 0.1 })
    out.push({ contractOption: 'differ', selectedDigit: d, barrier: null, hits: n - counts[d]!, p: 0.9 })
  }
  return out
}

function countsLineFor(contractType: ContractType, best: Candidate, counts: number[], n: number): string {
  const tail = `in last ${n} ticks`
  if (contractType === 'EVEN_ODD') {
    const even = best.contractOption === 'even' ? best.hits : n - best.hits
    return `EVEN ${even} / ODD ${n - even} ${tail}`
  }
  if (contractType === 'OVER_UNDER') {
    const b = best.barrier!
    const under = counts.slice(0, b).reduce((sum, c) => sum + c, 0)
    const over = n - under - counts[b]!
    const sides = [b <= 8 ? `OVER ${b}: ${over}` : null, b >= 1 ? `UNDER ${b}: ${under}` : null, `EQUAL ${b}: ${counts[b]}`]
    return `${sides.filter(Boolean).join(' / ')} ${tail}`
  }
  const d = best.selectedDigit!
  return `Digit ${d} appeared ${counts[d]} times ${tail} (${Math.round(n / 10)} expected)`
}

export function strongestSetup(
  symbol: string,
  digits: readonly number[],
  contractType: ContractType,
  window: number,
): ScannerPick | null {
  const sample = window > 0 ? digits.slice(-window) : [...digits]
  const counts = Array.from({ length: 10 }, () => 0)
  let n = 0
  for (const digit of sample) {
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) continue
    counts[digit]! += 1
    n += 1
  }
  if (n === 0) return null
  let best: Candidate | null = null
  let bestDeviation = -Infinity
  for (const candidate of candidatesFor(contractType, counts, n)) {
    const deviation = deviationOf(candidate.hits, n, candidate.p)
    if (deviation > bestDeviation + 1e-9) {
      best = candidate
      bestDeviation = deviation
    }
  }
  if (!best) return null
  return {
    symbol,
    contractType,
    contractOption: best.contractOption,
    selectedDigit: best.selectedDigit,
    barrier: best.barrier,
    hits: best.hits,
    expected: Math.round(n * best.p),
    sampleSize: n,
    deviation: bestDeviation,
    countsLine: countsLineFor(contractType, best, counts, n),
  }
}

export function rankVolatilities(
  markets: ReadonlyArray<{ symbol: string; digits: readonly number[] }>,
  contractType: ContractType,
  window: number,
): ScannerPick[] {
  return markets
    .map((market, index) => ({ index, pick: strongestSetup(market.symbol, market.digits, contractType, window) }))
    .filter((item): item is { index: number; pick: ScannerPick } => item.pick != null)
    .sort((a, b) => b.pick.deviation - a.pick.deviation || a.index - b.index)
    .map((item) => item.pick)
}

export function scanQuality(deviation: number): number {
  const z = Number.isFinite(deviation) ? Math.max(0, deviation) : 0
  const score = (1 - Math.exp(-z / 2.2)) * 100
  return Math.round(Math.min(99.99, score) * 100) / 100
}

export function bestScanPick(
  markets: ReadonlyArray<{ symbol: string; digits: readonly number[] }>,
  contractType: ContractType,
  samples: readonly number[] = [...AI_SCANNER_SAMPLES].sort((a, b) => b - a),
): ScannerPick | null {
  let best: ScannerPick | null = null
  for (const window of samples) {
    const top = rankVolatilities(markets, contractType, window)[0]
    if (top && (!best || top.deviation > best.deviation + 1e-9)) best = top
  }
  return best
}

export function pickLabel(pick: Pick<ScannerPick, 'contractOption' | 'selectedDigit' | 'barrier'>): string {
  const side = pick.contractOption.toUpperCase()
  if (pick.selectedDigit != null) return `${side} ${pick.selectedDigit}`
  if (pick.barrier != null) return `${side} ${pick.barrier}`
  return side
}
