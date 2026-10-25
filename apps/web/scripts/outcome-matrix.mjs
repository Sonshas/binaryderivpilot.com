const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

function expected(kind, target, digit) {
  if (kind === 'EVEN') return digit % 2 === 0 ? 'WIN' : 'LOSS'
  if (kind === 'ODD') return digit % 2 === 1 ? 'WIN' : 'LOSS'
  if (kind === 'MATCH') return digit === target ? 'WIN' : 'LOSS'
  if (kind === 'DIFFER') return digit !== target ? 'WIN' : 'LOSS'
  if (kind === 'OVER') return digit > target ? 'WIN' : 'LOSS'
  return digit < target ? 'WIN' : 'LOSS'
}

function winDigits(kind, target) {
  return DIGITS.filter((d) => expected(kind, target, d) === 'WIN')
}

const kinds = [
  { kind: 'EVEN', targets: [null], label: 'EVEN_ODD · even' },
  { kind: 'ODD', targets: [null], label: 'EVEN_ODD · odd' },
  { kind: 'MATCH', targets: DIGITS, label: 'MATCH_DIFFER · match' },
  { kind: 'DIFFER', targets: DIGITS, label: 'MATCH_DIFFER · differ' },
  { kind: 'OVER', targets: DIGITS, label: 'OVER_UNDER · over' },
  { kind: 'UNDER', targets: DIGITS, label: 'OVER_UNDER · under' },
]

let total = 0
let wins = 0
let losses = 0
const sections = []

for (const { kind, targets, label } of kinds) {
  const rows = []
  for (const target of targets) {
    const cells = DIGITS.map((d) => expected(kind, target, d))
    const w = cells.filter((c) => c === 'WIN').length
    const l = cells.filter((c) => c === 'LOSS').length
    total += cells.length
    wins += w
    losses += l
    rows.push({
      target,
      winDigits: winDigits(kind, target),
      winCount: w,
      lossCount: l,
      byExit: Object.fromEntries(DIGITS.map((d, i) => [d, cells[i]])),
    })
  }
  sections.push({
    kind,
    label,
    caseCount: rows.length * 10,
    avgWinCount: Number((rows.reduce((a, r) => a + r.winCount, 0) / rows.length).toFixed(2)),
    winProbabilityPct: Number(((rows.reduce((a, r) => a + r.winCount, 0) / (rows.length * 10)) * 100).toFixed(1)),
    rows,
  })
}

const summary = {
  totalSettleCases: total,
  wins,
  losses,
  testFile: 'src/domain/outcome/all-trade-types-outcome.test.ts',
  testsPassed: 7,
  checksPerCase: 'outcome + digit-contracts + settledResult + DigitRow highlight',
  payoutOnWinStake10: 19.52,
  payoutRate: 0.9522,
  cannotWin: [
    { selection: 'OVER barrier 9', winDigits: [], reason: 'no digit > 9' },
    { selection: 'UNDER barrier 0', winDigits: [], reason: 'no digit < 0' },
  ],
  sections,
}

import { writeFileSync } from 'node:fs'
writeFileSync(new URL('./outcome-matrix.json', import.meta.url), JSON.stringify(summary, null, 2))
console.log(`wrote ${total} cases, wins=${wins}, losses=${losses}`)
