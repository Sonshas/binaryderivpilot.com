import type { DepositProvider } from '@/domain/daraja'
import {
  hydrateExternalPayments,
  hydrateGatePaidFromServer,
  saveExternalPayments,
  saveWithdrawPlace,
  type ExternalPayments,
  type WithdrawPlace,
} from '@/lib/external-payments'
import { hydratePayMode } from '@/lib/pay-mode'
import { markScannerPaid } from '@/lib/scanner-access'
import { getSupabase } from '@/lib/supabase'
import { edgeErrorMessage } from '@/services/system-issues'

const FUNCTION = 'platform-settings'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export type MegapayAccountId = 'winsoft' | 'vast'

export type MegapayAccountPublic = {
  id: MegapayAccountId
  label: string
  enabled: boolean
  configured: boolean
  emailHint: string | null
  keyHint: string | null
}

type GatesPayload = {
  paid?: Partial<Record<'verification' | 'scanner' | 'tax', string>>
  place?: WithdrawPlace | null
}

type PlatformPayload = {
  ok?: boolean
  withdraw?: ExternalPayments
  payMode?: DepositProvider
  megapayAccounts?: MegapayAccountPublic[]
  gates?: GatesPayload
  message?: string
  error?: string
}

async function invoke(
  body?: Record<string, unknown>,
  method: 'GET' | 'POST' = 'POST',
): Promise<Result<PlatformPayload>> {
  const client = getSupabase()
  if (!client) return { ok: false, error: 'Supabase is not configured.' }
  const { data, error } = await client.functions.invoke<PlatformPayload>(FUNCTION, {
    method,
    body: method === 'GET' ? undefined : body,
  })
  if (error) {
    return {
      ok: false,
      error: await edgeErrorMessage(error, 'Platform settings request failed.', {
        area: 'admin',
        operation: `platform-settings.${String(body?.action ?? method.toLowerCase())}`,
      }),
    }
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'Empty platform-settings response.' }
  if (typeof data.error === 'string') return { ok: false, error: data.error }
  return { ok: true, data }
}

function applyPayload(payload: PlatformPayload, email?: string | null): void {
  if (payload.withdraw) hydrateExternalPayments(payload.withdraw)
  if (payload.payMode) hydratePayMode(payload.payMode)
  const key = email?.trim().toLowerCase() ?? ''
  if (!key) return
  const paid = payload.gates?.paid
  if (paid) {
    hydrateGatePaidFromServer(paid, key)
    if (paid.scanner) markScannerPaid(key)
  }
  if (payload.gates?.place) {
    saveWithdrawPlace(key, payload.gates.place, { localOnly: true })
  }
}

export const platformSettingsService = {
  async load(email?: string | null): Promise<
    Result<{
      withdraw: ExternalPayments
      payMode: DepositProvider
      megapayAccounts: MegapayAccountPublic[]
    }>
  > {
    const result = await invoke(undefined, 'GET')
    if (!result.ok) return result
    applyPayload(result.data, email)
    if (!result.data.withdraw || !result.data.payMode) {
      return { ok: false, error: 'Platform settings incomplete.' }
    }
    return {
      ok: true,
      data: {
        withdraw: result.data.withdraw,
        payMode: result.data.payMode,
        megapayAccounts: result.data.megapayAccounts ?? [],
      },
    }
  },

  async saveWithdraw(patch: Partial<ExternalPayments>): Promise<Result<ExternalPayments>> {
    const result = await invoke({ action: 'save_withdraw', ...patch })
    if (!result.ok) return result
    const saved = result.data.withdraw
      ? hydrateExternalPayments(result.data.withdraw)
      : saveExternalPayments(patch)
    return { ok: true, data: saved }
  },

  async savePayMode(mode: DepositProvider): Promise<Result<DepositProvider>> {
    const result = await invoke({ action: 'save_pay_mode', payMode: mode })
    if (!result.ok) return result
    const saved = hydratePayMode(result.data.payMode ?? mode)
    return { ok: true, data: saved }
  },

  async saveMegapayAccounts(
    patch: Partial<Record<MegapayAccountId, boolean>>,
  ): Promise<Result<{ accounts: MegapayAccountPublic[]; message: string }>> {
    const result = await invoke({ action: 'save_megapay_accounts', ...patch })
    if (!result.ok) return result
    return {
      ok: true,
      data: {
        accounts: result.data.megapayAccounts ?? [],
        message: result.data.message ?? 'MegaPay accounts saved.',
      },
    }
  },
}
