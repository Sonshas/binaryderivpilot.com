import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { parseStkCallback } from '../_shared/daraja.ts'
import { maskPhone } from '../_shared/megapay.ts'
import { adminClient, logEdgeError } from '../_shared/server.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { DARAJA_PROVIDER } from '../_shared/daraja.ts'
import {
  DARAJA_DEPOSIT_COLUMNS,
  darajaConfig,
  findByCheckoutRequestId,
  reconcileDarajaDeposit,
  type DarajaDepositRow,
} from '../_shared/daraja-server.ts'
import { findServiceCharge, settleServiceCharge } from '../_shared/service-charges.ts'

const MAX_BODY_BYTES = 32 * 1024

function accepted() {
  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function findByDepositReference(admin: SupabaseClient, reference: string): Promise<DarajaDepositRow | null> {
  const ref = reference.trim().toUpperCase()
  if (!ref) return null
  const { data } = await admin
    .from('deposits')
    .select(DARAJA_DEPOSIT_COLUMNS)
    .eq('provider', DARAJA_PROVIDER)
    .filter('details->>reference', 'eq', ref)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as DarajaDepositRow | null) ?? null
}

async function handleCallback(rawBody: string, referenceFromUrl: string | null) {
  let payload: unknown = null
  try {
    payload = JSON.parse(rawBody)
  } catch {
    payload = null
  }
  const cb = parseStkCallback(payload)
  if (!cb.ok) {
    console.log('mpesa callback ignored', cb.error)
    return
  }

  const admin = adminClient()
  const charge = await findServiceCharge(admin, cb.checkoutRequestId)
  if (charge) {
    console.log('mpesa callback service charge', charge.id, charge.kind, cb.resultCode, cb.receipt ?? '-')
    await settleServiceCharge(admin, charge, cb)
    return
  }
  let deposit = await findByCheckoutRequestId(admin, cb.checkoutRequestId)
  if (!deposit && referenceFromUrl) {
    deposit = await findByDepositReference(admin, referenceFromUrl)
    if (deposit) console.log('mpesa callback matched by reference', referenceFromUrl)
  }
  if (!deposit) {
    console.log('mpesa callback: no matching deposit', cb.resultCode)
    return
  }
  console.log('mpesa callback', deposit.id, cb.resultCode, cb.phone ? maskPhone(cb.phone) : '-', cb.receipt ?? '-')

  const update: Record<string, unknown> = {
    callback_at: new Date().toISOString(),
    result_code: String(cb.resultCode),
    result_desc: cb.resultDesc.slice(0, 300),
  }
  if (cb.outcome === 'completed') update.callback_amount_kes = cb.amountKes
  if (cb.merchantRequestId && !deposit.merchant_request_id) update.merchant_request_id = cb.merchantRequestId
  const { error } = await admin.from('deposits').update(update).eq('id', deposit.id)
  if (error) await logEdgeError(admin, 'deposits', 'mpesa-callback.store', error, { code: error.code })

  if (cb.outcome === 'completed' && cb.receipt) {
    const { error: receiptError } = await admin
      .from('deposits')
      .update({ mpesa_receipt: cb.receipt })
      .eq('id', deposit.id)
      .is('mpesa_receipt', null)
    if (receiptError) {
      await logEdgeError(admin, 'deposits', 'mpesa-callback.store_receipt', receiptError, { code: receiptError.code })
    }
  }

  const fresh = (await findByCheckoutRequestId(admin, cb.checkoutRequestId)) ?? deposit
  const settled = await reconcileDarajaDeposit(admin, darajaConfig(), fresh, { force: true })
  console.log('mpesa callback settled', deposit.id, settled.status)
}

Deno.serve(async (req) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return new Response(JSON.stringify({ status: 'ok', service: 'mpesa-callback' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (req.method !== 'POST') return accepted()

  const referenceFromUrl = (() => {
    try {
      return new URL(req.url).searchParams.get('reference')
    } catch {
      return null
    }
  })()

  let rawBody = ''
  try {
    const declared = Number(req.headers.get('content-length') ?? '0')
    if (declared <= MAX_BODY_BYTES) rawBody = await req.text()
  } catch {
    rawBody = ''
  }
  if (!rawBody || rawBody.length > MAX_BODY_BYTES) {
    console.log('mpesa callback ignored', rawBody ? 'too_large' : 'empty_body')
    return accepted()
  }

  EdgeRuntime.waitUntil(
    handleCallback(rawBody, referenceFromUrl).catch(async (err) => {
      try {
        await logEdgeError(adminClient(), 'deposits', 'mpesa-callback.process', err)
      } catch {
        console.error('mpesa callback processing failed', String(err).slice(0, 200))
      }
    }),
  )
  return accepted()
})
