import { DEFAULT_DEPOSIT_PROVIDER, parseDepositProvider, type DepositProvider } from '@/domain/daraja'
import { hydratePayMode, readSavedPayMode } from '@/lib/pay-mode'
import { parseMegapayConfig } from '@/domain/megapay'
import { loadDemoSession } from '@/lib/demo-session'
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

export function resolveDepositProvider(raw: unknown): DepositProvider {
  const provider = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).provider : undefined
  return typeof provider === 'string' ? parseDepositProvider(provider) : DEFAULT_DEPOSIT_PROVIDER
}

export function depositMethodLabel(config: Pick<DepositConfig, 'provider' | 'paybill'>): string {
  return config.provider === 'daraja' && config.paybill ? `M-Pesa (Paybill ${config.paybill})` : 'M-Pesa'
}

function savedDepositConfig(): Result<DepositConfig> | null {
  if (!loadDemoSession()?.email) return null
  const saved = readSavedHostFees()?.deposit
  const base = parseMegapayConfig({})
  const quick = (saved?.quickAmounts ?? '1600,2500,5000,10000')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((amount) => Number.isInteger(amount) && amount > 0)
  return {
    ok: true,
    data: {
      provider: readSavedPayMode() ?? 'daraja',
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
    if (!client) return savedDepositConfig() ?? { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(DARAJA_FUNCTIONS.start, { method: 'GET' })
    if (error || !data) return savedDepositConfig() ?? { ok: false, error: await errorMessage(error) }

    const provider = resolveDepositProvider(data)
    hydratePayMode(provider)
    if (provider === 'megapay') {
      const fallback = await megapayService.getConfig()
      return fallback.ok ? { ok: true, data: { ...fallback.data, provider: 'megapay', paybill: null } } : fallback
    }
    const quick = Array.isArray(data.quick_amounts)
      ? data.quick_amounts.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
      : undefined
    return {
      ok: true,
      data: {
        provider: 'daraja',
        paybill: typeof data.paybill === 'string' && data.paybill ? data.paybill : null,
        enabled: data.enabled === true,
        kesPerUsd: Number(data.kes_per_usd),
        minKes: Number(data.min_kes),
        maxKes: Number(data.max_kes),
        quickAmounts: quick && quick.length ? quick : undefined,
        message: (data.message as string | null) ?? null,
      },
    }
  },

  async startDeposit(provider: DepositProvider, amountKes: number, phone: string): Promise<Result<DepositState>> {
    if (provider === 'megapay') return megapayService.startDeposit(amountKes, phone)
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(DARAJA_FUNCTIONS.start, {
      method: 'POST',
      body: { amount_kes: amountKes, phone },
    })
    if (error || !data) return { ok: false, error: await errorMessage(error) }
    return { ok: true, data: mapState(data) }
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
