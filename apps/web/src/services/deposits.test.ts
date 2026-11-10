import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Array<{ name: string; method: string; body?: unknown }> = []
const responses = new Map<string, unknown>()

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    functions: {
      async invoke(name: string, options: { method: string; body?: unknown }) {
        calls.push({ name, method: options.method, body: options.body })
        const data = responses.get(`${options.method} ${name}`)
        return data ? { data, error: null } : { data: null, error: new Error('not found') }
      },
    },
  }),
}))

const { depositMethodLabel, depositService, resolveDepositProvider } = await import('@/services/deposits')

const darajaConfig = {
  provider: 'daraja',
  enabled: true,
  paybill: '4088285',
  kes_per_usd: 130,
  min_kes: 1600,
  max_kes: 150000,
  message: null,
}
const megapayConfig = { enabled: true, kes_per_usd: 130, min_kes: 1600, max_kes: 150000, message: null }
const pending = { deposit_id: 'd1', reference: 'OMT-ABCD2345', status: 'PENDING', amount_usd: 12.31, amount_kes: 1600, receipt: null, failure_reason: null }

beforeEach(() => {
  calls.length = 0
  responses.clear()
})

describe('resolveDepositProvider', () => {
  it('defaults to daraja and honours megapay', () => {
    expect(resolveDepositProvider({ provider: 'daraja' })).toBe('daraja')
    expect(resolveDepositProvider({ provider: 'megapay' })).toBe('megapay')
    expect(resolveDepositProvider({})).toBe('daraja')
    expect(resolveDepositProvider(null)).toBe('daraja')
  })

  it('labels the Paybill for Daraja', () => {
    expect(depositMethodLabel({ provider: 'daraja', paybill: '4088285' })).toBe('M-Pesa (Paybill 4088285)')
    expect(depositMethodLabel({ provider: 'megapay', paybill: null })).toBe('M-Pesa')
  })
})

describe('depositService provider selection', () => {
  it('uses the Daraja functions when MegaPay config is unavailable', async () => {
    responses.set('GET mpesa-deposit', darajaConfig)
    responses.set('POST mpesa-deposit', pending)
    responses.set('POST mpesa-status', { ...pending, status: 'COMPLETED', receipt: 'NLJ7RT61SV' })

    const config = await depositService.getConfig()
    expect(config).toEqual({
      ok: true,
      data: { provider: 'daraja', paybill: '4088285', enabled: true, kesPerUsd: 130, minKes: 1600, maxKes: 150000, message: null },
    })
    const started = await depositService.startDeposit('daraja', 1600, '254712345678')
    expect(started.ok && started.data.status).toBe('PENDING')
    const status = await depositService.checkStatus('daraja', 'd1')
    expect(status.ok && status.data.receipt).toBe('NLJ7RT61SV')
    const depositCalls = calls
      .filter((c) => c.name !== 'system-issues')
      .map((c) => `${c.method} ${c.name}`)
    expect(depositCalls).toEqual([
      'GET megapay-deposit',
      'GET mpesa-deposit',
      'POST mpesa-deposit',
      'POST mpesa-status',
    ])
    expect(calls.find((c) => c.method === 'POST' && c.name === 'mpesa-deposit')?.body).toEqual({
      amount_kes: 1600,
      phone: '254712345678',
    })
  })

  it('loads MegaPay config first when the MegaPay rail is available', async () => {
    responses.set('GET megapay-deposit', megapayConfig)
    responses.set('POST megapay-deposit', pending)
    responses.set('POST megapay-status', pending)

    const config = await depositService.getConfig()
    expect(config.ok && config.data.provider).toBe('megapay')
    expect(config.ok && config.data.minKes).toBe(1600)
    await depositService.startDeposit('megapay', 1600, '254712345678')
    await depositService.checkStatus('megapay', 'd1')
    expect(calls.map((c) => `${c.method} ${c.name}`)).toEqual([
      'GET megapay-deposit',
      'POST megapay-deposit',
      'POST megapay-status',
    ])
  })

  it('falls back to local fee defaults when Edge config probes fail', async () => {
    const config = await depositService.getConfig()
    expect(config.ok).toBe(true)
    if (!config.ok) return
    expect(config.data.enabled).toBe(true)
    expect(config.data.provider).toBe('megapay')
    expect(config.data.minKes).toBeGreaterThan(0)
    expect(config.data.maxKes).toBeGreaterThan(config.data.minKes)
  })

  it('ignores incomplete MegaPay payloads and uses the Daraja probe', async () => {
    responses.set('GET megapay-deposit', { provider: 'daraja' })
    responses.set('GET mpesa-deposit', darajaConfig)

    const config = await depositService.getConfig()
    expect(config).toEqual({
      ok: true,
      data: {
        provider: 'daraja',
        paybill: '4088285',
        enabled: true,
        kesPerUsd: 130,
        minKes: 1600,
        maxKes: 150000,
        message: null,
      },
    })
  })
})
