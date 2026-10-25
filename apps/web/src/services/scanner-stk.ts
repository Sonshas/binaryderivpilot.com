import { getSupabase } from '@/lib/supabase'
import { edgeErrorMessage } from '@/services/system-issues'

const FUNCTION = 'scanner-stk'
const UNAVAILABLE = 'Payments temporarily unavailable. Nothing was taken from your trading balance.'

export type ExternalStkKind = 'scanner' | 'verification' | 'tax'
export type ScannerStkStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

async function authedClient() {
  const client = getSupabase()
  if (!client) return null
  const { data } = await client.auth.getSession()
  if (!data.session) return null
  return client
}

export const scannerStkService = {
  async start(
    amountKes: number,
    phone: string,
    kind: ExternalStkKind = 'scanner',
  ): Promise<Result<{ checkoutRequestId: string; amountKes: number }>> {
    const client = await authedClient()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, {
      method: 'POST',
      body: { action: 'start', amount_kes: amountKes, phone, kind },
    })
    if (error || !data || typeof data.checkout_request_id !== 'string') {
      return { ok: false, error: await edgeErrorMessage(error, UNAVAILABLE, { area: 'payments', operation: 'scanner-stk.start' }) }
    }
    return { ok: true, data: { checkoutRequestId: data.checkout_request_id, amountKes: Number(data.amount_kes) } }
  },

  async status(checkoutRequestId: string): Promise<Result<{ status: ScannerStkStatus; failureReason: string | null }>> {
    const client = await authedClient()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, {
      method: 'POST',
      body: { action: 'status', checkout_request_id: checkoutRequestId },
    })
    if (error || !data || typeof data.status !== 'string') {
      return { ok: false, error: await edgeErrorMessage(error, UNAVAILABLE, { area: 'payments', operation: 'scanner-stk.status' }) }
    }
    const status = data.status as ScannerStkStatus
    return {
      ok: true,
      data: {
        status,
        failureReason: typeof data.failure_reason === 'string' ? data.failure_reason : null,
      },
    }
  },
}
