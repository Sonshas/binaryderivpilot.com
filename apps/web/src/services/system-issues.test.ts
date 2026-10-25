import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn(() => Promise.resolve({ data: { ok: true }, error: null }))
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ functions: { invoke } }) }))

const { edgeErrorMessage, isTransientBackendNoise, reportBackendIssue } = await import('./system-issues')

function edgeError(status: number, body: unknown) {
  return { context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }
}

describe('edgeErrorMessage', () => {
  beforeEach(() => invoke.mockClear())

  it('passes 4xx business messages through without reporting', async () => {
    const text = await edgeErrorMessage(edgeError(400, { error: 'Insufficient balance' }), 'Unavailable', {
      area: 'trading',
      operation: 'edge.test_4xx',
    })
    expect(text).toBe('Insufficient balance')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('hides 5xx details from users and reports them for staff', async () => {
    const text = await edgeErrorMessage(
      edgeError(500, { error: 'relation "public.wallets" does not exist' }),
      'Unavailable',
      { area: 'trading', operation: 'edge.test_5xx' },
    )
    expect(text).toBe('Unavailable')
    expect(invoke).toHaveBeenCalledTimes(1)
    const [, options] = invoke.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }]
    expect(options.body).toMatchObject({ action: 'report', area: 'trading', operation: 'edge.test_5xx', code: '500' })
  })

  it('returns the fallback for network failures without opening a staff issue', async () => {
    const text = await edgeErrorMessage(new Error('Failed to send a request to the Edge Function'), 'Unavailable', {
      area: 'trading',
      operation: 'edge.test_network',
    })
    expect(text).toBe('Unavailable')
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('isTransientBackendNoise', () => {
  it('matches edge fetch and Deriv reconnect noise', () => {
    expect(isTransientBackendNoise('Failed to send a request to the Edge Function')).toBe(true)
    expect(isTransientBackendNoise('Deriv WebSocket closed')).toBe(true)
    expect(isTransientBackendNoise('Deriv WebSocket error')).toBe(true)
    expect(isTransientBackendNoise('Deriv unavailable')).toBe(true)
    expect(isTransientBackendNoise('Deriv connection timeout')).toBe(true)
    expect(isTransientBackendNoise('Live price is unavailable right now. Your balance was not charged — please try again.')).toBe(true)
    expect(isTransientBackendNoise('Request idle timeout limit (150s) reached')).toBe(true)
    expect(isTransientBackendNoise("undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')")).toBe(true)
    expect(isTransientBackendNoise('signal timed out')).toBe(true)
    expect(isTransientBackendNoise('TimeoutError: signal timed out')).toBe(true)
    expect(isTransientBackendNoise('relation "wallets" does not exist')).toBe(false)
  })
})

describe('reportBackendIssue', () => {
  beforeEach(() => invoke.mockClear())

  it('throttles repeats of the same failure', () => {
    reportBackendIssue('wallet', 'wallets.throttle', { code: '42P01', message: 'missing' })
    reportBackendIssue('wallet', 'wallets.throttle', { code: '42P01', message: 'missing' })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('skips Deriv reconnect noise', () => {
    reportBackendIssue('market_data', 'ticks.history', new Error('Deriv WebSocket closed'))
    expect(invoke).not.toHaveBeenCalled()
  })
})
