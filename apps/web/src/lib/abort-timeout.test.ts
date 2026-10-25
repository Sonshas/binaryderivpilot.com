import { describe, expect, it, vi } from 'vitest'
import { abortSignalAfter } from './abort-timeout'

describe('abortSignalAfter', () => {
  it('aborts after the delay when AbortSignal.timeout is missing', async () => {
    const original = AbortSignal.timeout
    // @ts-expect-error force legacy path
    AbortSignal.timeout = undefined
    try {
      vi.useFakeTimers()
      const signal = abortSignalAfter(50)
      expect(signal.aborted).toBe(false)
      vi.advanceTimersByTime(50)
      expect(signal.aborted).toBe(true)
    } finally {
      AbortSignal.timeout = original
      vi.useRealTimers()
    }
  })
})
