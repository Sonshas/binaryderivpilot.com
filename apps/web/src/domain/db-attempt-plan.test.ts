import { describe, expect, it } from 'vitest'
import { freshAttemptPlan } from '../../../../supabase/functions/_shared/db-attempt-plan.ts'

describe('freshAttemptPlan', () => {
  it('gives a short dashboard budget one attempt long enough to connect', () => {
    expect(freshAttemptPlan(4_500, 3)).toEqual({ attempts: 1, perAttemptMs: 4_500 })
  })

  it('keeps the whole budget for one deposit read', () => {
    expect(freshAttemptPlan(18_000, 6)).toEqual({ attempts: 1, perAttemptMs: 18_000 })
  })

  it('does not slice a 3s fallback into sub-connect attempts', () => {
    expect(freshAttemptPlan(3_000, 4)).toEqual({ attempts: 1, perAttemptMs: 3_000 })
  })

  it('keeps an 8s read as one attempt', () => {
    expect(freshAttemptPlan(8_000, 6)).toEqual({ attempts: 1, perAttemptMs: 8_000 })
  })
})