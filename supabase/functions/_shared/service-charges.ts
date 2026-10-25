import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { ParsedStkCallback } from './daraja.ts'
import { DEFAULT_KES_PER_USD, kesToUsd } from './megapay.ts'
import { lookupUserEmail, notifyAdminsPaymentReceived } from './admin-payment-email.ts'
import { logEdgeError } from './server.ts'

export const SERVICE_KINDS = ['verification', 'scanner', 'tax'] as const
export type ServiceKind = (typeof SERVICE_KINDS)[number]

const STK_COPY: Record<ServiceKind, { description: string; accountReference: string; note: string }> = {
  verification: { description: 'Verification', accountReference: 'SVC-VERIFY', note: 'Account verification service charge' },
  scanner: { description: 'AI scanner', accountReference: 'SVC-SCANNER', note: 'AI scanner service charge' },
  tax: { description: 'Tax fee', accountReference: 'SVC-TAX', note: 'Tax compliance service charge' },
}

export function serviceKind(value: unknown): ServiceKind | null {
  const kind = String(value ?? '')
  return kind === 'verification' || kind === 'scanner' || kind === 'tax' ? kind : null
}

export function serviceStkCopy(kind: ServiceKind): { description: string; accountReference: string } {
  return { description: STK_COPY[kind].description, accountReference: STK_COPY[kind].accountReference }
}

export function serviceChargeNote(kind: ServiceKind): string {
  return STK_COPY[kind].note
}

export function servicePaymentLabel(kind: ServiceKind): string {
  if (kind === 'verification') return 'Account verification'
  if (kind === 'scanner') return 'AI scanner'
  return 'Tax compliance'
}

/** Deposit rows for scanner / verification / tax STKs (no wallet credit). */
export function isServiceChargeDepositDetails(details: Record<string, unknown> | null | undefined): boolean {
  if (!details) return false
  if (details.type === 'service_charge') return true
  const kind = details.kind
  return kind === 'verification' || kind === 'scanner' || kind === 'tax'
}

export async function feeKesPerUsd(admin: SupabaseClient): Promise<number> {
  // Withdrawal Controls prompt rate only — never DEPOSIT/WITHDRAWAL rates from Admin → Fees.
  const { data } = await admin
    .from('payment_settings')
    .select('value')
    .eq('key', 'WITHDRAW_PROMPT_KES_PER_USD')
    .maybeSingle()
  const prompt = Number((data as { value?: unknown } | null)?.value)
  return Number.isFinite(prompt) && prompt > 0 ? prompt : DEFAULT_KES_PER_USD
}

export function serviceUsd(amountKes: number, kesPerUsd: number): number {
  return kesToUsd(amountKes, kesPerUsd)
}

export interface ServiceChargeRow {
  id: string
  user_id: string
  kind: ServiceKind
  amount_kes: number | string
  amount_usd: number | string
  status: string
  checkout_request_id: string | null
}

export async function findServiceCharge(admin: SupabaseClient, checkoutRequestId: string): Promise<ServiceChargeRow | null> {
  const { data } = await admin.from('service_charges').select('id, user_id, kind, amount_kes, amount_usd, status, checkout_request_id').eq('checkout_request_id', checkoutRequestId).maybeSingle()
  return (data as ServiceChargeRow | null) ?? null
}

export async function settleServiceCharge(admin: SupabaseClient, charge: ServiceChargeRow, cb: ParsedStkCallback): Promise<void> {
  if (cb.outcome === 'completed') {
    const { error } = await admin.rpc('complete_service_charge', {
      p_charge_id: charge.id,
      p_receipt: cb.receipt ?? '',
      p_amount_kes: cb.amountKes,
    })
    if (error) {
      await logEdgeError(admin, 'deposits', 'service_charge.complete', error, { code: error.code })
    } else {
      console.log('service charge recorded', charge.id, charge.kind)
      const userEmail = await lookupUserEmail(admin, charge.user_id)
      await notifyAdminsPaymentReceived(admin, {
        amountKes: Number(cb.amountKes),
        kind: charge.kind,
        userEmail,
        receipt: cb.receipt ?? null,
        depositId: charge.id,
      })
    }
    return
  }
  if (charge.status !== 'PENDING') return
  const status = cb.outcome === 'cancelled' ? 'CANCELLED' : 'FAILED'
  const { error } = await admin
    .from('service_charges')
    .update({ status, callback_at: new Date().toISOString() })
    .eq('id', charge.id)
    .eq('status', 'PENDING')
  if (error) await logEdgeError(admin, 'deposits', 'service_charge.status', error, { code: error.code })
  else console.log('service charge', status.toLowerCase(), charge.id, charge.kind)
}
