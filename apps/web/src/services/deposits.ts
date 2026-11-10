import { DEFAULT_DEPOSIT_PROVIDER, parseDepositProvider, type DepositProvider } from '@/domain/daraja'
import { hydratePayMode, readSavedPayMode } from '@/lib/pay-mode'
import { parseMegapayConfig } from '@/domain/megapay'
import { raceWithTimeout } from '@/lib/abort-timeout'
import { getSupabase } from '@/lib/supabase'
import { readSavedHostFees } from '@/services/admin-fees'
import {
  UNAVAILABLE,
  errorMessage,
  mapState,
  megapayService,
  type MegapayDepositConfig,
  type MegapayDepositState,
  type Result,
} from '@/services/megapay'

export interface DepositConfig extends MegapayDepositConfig {
  provider: DepositProvider
  paybill: string | null
}

export type DepositState = MegapayDepositState

const DARAJA_FUNCTIONS = { start: 'mpesa-deposit', status: 'mpesa-status' } as const
/** Match the browser Edge fetch budget; 5s left cold starts on "busy". */
const CONFIG_BUDGET_MS = 12_000
const START_BUDGET_MS = 25_000
const CONFIG_BUSY = 'Deposits are busy right now. Please try again.'

export function resolveDepositProvider(raw: unknown): DepositProvider {
  const provider = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).provider : undefined
  return typeof provider === 'string' ? parseDepositProvider(provider) : DEFAULT_DEPOSIT_PROVIDER
}

export function depositMethodLabel(config: Pick<DepositConfig, 'provider' | 'paybill'>): string {
  return config.provider === 'daraja' && config.paybill ? `M-Pesa (Paybill ${config.paybill})` : 'M-Pesa'
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** A provider-only body (`{ provider }`) has no enabled flag. Missing enabled is not a pause. */
export function depositConfigFromPayload(data: Record<string, unknown>, provider: DepositProvider): DepositConfig | null {
  if (typeof data.enabled !== 'boolean') return null
  const kesPerUsd = finiteNumber(data.kes_per_usd)
  const minKes = finiteNumber(data.min_kes)
  const maxKes = finiteNumber(data.max_kes)
  if (kesPerUsd == null || minKes == null || maxKes == null) return null
  const quick = Array.isArray(data.quick_amounts)
    ? data.quick_amounts.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    : undefined
  return {
    provider,
    paybill: provider === 'daraja' && typeof data.paybill === 'string' && data.paybill ? data.paybill : null,
    enabled: data.enabled,
    kesPerUsd,
    minKes,
    maxKes,
    quickAmounts: quick && quick.length ? quick : undefined,
    message: typeof data.message === 'string' ? data.message : null,
  }
}

function configFromMegapay(data: MegapayDepositConfig): DepositConfig | null {
  return depositConfigFromPayload(
    {
      enabled: data.enabled,
      kes_per_usd: data.kesPerUsd,
      min_kes: data.minKes,
      max_kes: data.maxKes,
      quick_amounts: data.quickAmounts,
      message: data.message,
    },
    'megapay',
  )
}

/** Local fee defaults so a cold/slow Edge probe never blocks the deposit form. */
function savedDepositConfig(): Result<DepositConfig> {
  const saved = readSavedHostFees()?.deposit
  const base = parseMegapayConfig({})
  const quick = (saved?.quickAmounts ?? '1600,2500,5000,10000')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((amount) => Number.isInteger(amount) && amount > 0)
  return {
    ok: true,
    data: {
      provider: readSavedPayMode() ?? 'megapay',
      paybill: null,
      enabled: true,
      kesPerUsd: saved?.kesPerUsd ?? base.kesPerUsd,
      minKes: saved?.minKes ?? base.minKes,
      maxKes: saved?.maxKes ?? base.maxKes,
      quickAmounts: quick.length ? quick : undefined,
      message: null,
    },
  }
}

export const depositService = {
  async getConfig(): Promise<Result<DepositConfig>> {
    const client = getSupabase()
    if (!client) return savedDepositConfig()

    // MegaPay is the live rail — load it first so a slow mpesa-deposit probe cannot starve the form.
    try {
      const megapay = await raceWithTimeout(megapayService.getConfig(), CONFIG_BUDGET_MS, CONFIG_BUSY)
      if (megapay.ok) {
        const inline = configFromMegapay(megapay.data)
        if (inline) {
          hydratePayMode('megapay')
          return { ok: true, data: inline }
        }
      }
    } catch {
      /* fall through to mpesa-deposit probe / saved config */
    }

    let data: Record<string, unknown> | null = null
    let error: unknown = null
    try {
      const result = await raceWithTimeout(
        client.functions.invoke<Record<string, unknown>>(DARAJA_FUNCTIONS.start, { method: 'GET' }),
        CONFIG_BUDGET_MS,
        CONFIG_BUSY,
      )
      data = result.data
      error = result.error
    } catch {
      return savedDepositConfig()
    }
    if (error || !data) return savedDepositConfig()

    const provider = resolveDepositProvider(data)
    hydratePayMode(provider)
    const inline = depositConfigFromPayload(data, provider)
    if (inline) return { ok: true, data: inline }
    return savedDepositConfig()
  },

  async startDeposit(provider: DepositProvider, amountKes: number, phone: string): Promise<Result<DepositState>> {
    if (provider === 'megapay') {
      try {
        return await raceWithTimeout(megapayService.startDeposit(amountKes, phone), START_BUDGET_MS, CONFIG_BUSY)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : CONFIG_BUSY }
      }
    }
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    try {
      const { data, error } = await raceWithTimeout(
        client.functions.invoke<Record<string, unknown>>(DARAJA_FUNCTIONS.start, {
          method: 'POST',
          body: { amount_kes: amountKes, phone },
        }),
        START_BUDGET_MS,
        CONFIG_BUSY,
      )
      if (error || !data) return { ok: false, error: await errorMessage(error) }
      return { ok: true, data: mapState(data) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : CONFIG_BUSY }
    }
  },

  async checkStatus(provider: DepositProvider, depositId: string): Promise<Result<DepositState>> {
    if (provider === 'megapay') return megapayService.checkStatus(depositId)
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(DARAJA_FUNCTIONS.status, {
      method: 'POST',
      body: { deposit_id: depositId },
    })
    if (error || !data) return { ok: false, error: await errorMessage(error) }
    return { ok: true, data: mapState(data) }
  },
}
