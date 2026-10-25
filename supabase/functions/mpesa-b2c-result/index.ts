import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { adminClient, logEdgeError } from '../_shared/server.ts'
import { findWithdrawalByConversation, loadWithdrawal } from '../_shared/withdraw-server.ts'
import { isOpenWithdrawalStatus, parseB2cResult } from '../_shared/withdrawals.ts'

const MAX_BODY_BYTES = 32 * 1024

function accepted() {
  return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function handle(rawBody: string, kind: 'result' | 'timeout') {
  let payload: unknown = null
  try {
    payload = JSON.parse(rawBody)
  } catch {
    payload = null
  }
  const parsed = parseB2cResult(payload)
  if (!parsed.ok) {
    console.log('b2c callback ignored', kind, parsed.error)
    return
  }

  const admin = adminClient()
  const row = await findWithdrawalByConversation(admin, parsed.originatorConversationId, parsed.conversationId)
  if (!row) {
    console.log('b2c callback: no matching withdrawal', kind, parsed.resultCode)
    return
  }
  console.log('b2c callback', kind, row.id, row.status, parsed.resultCode, parsed.receipt ?? '-')

  const raw = {
    source: kind === 'timeout' ? 'daraja_b2c_timeout' : 'daraja_b2c_result',
    result_code: String(parsed.resultCode),
    result_desc: parsed.resultDesc.slice(0, 300),
    conversation_id: parsed.conversationId,
    transaction_id: parsed.transactionId,
    amount_kes: parsed.amountKes,
    receiver: parsed.receiverName,
    completed_at: parsed.completedAt,
    received_at: new Date().toISOString(),
  }

  if (parsed.conversationId && !row.conversation_id) {
    await admin.from('withdrawals').update({ conversation_id: parsed.conversationId }).eq('id', row.id).is('conversation_id', null)
  }

  if (!isOpenWithdrawalStatus(row.status)) {
    if (kind === 'result' && parsed.outcome === 'completed' && row.status === 'FAILED') {
      await logEdgeError(admin, 'withdrawals', 'b2c.late_success_after_refund', `${row.id} ${parsed.receipt ?? ''}`)
      await admin
        .from('withdrawals')
        .update({
          admin_note: `REVIEW: B2C reported success (receipt ${parsed.receipt ?? '?'}) after this request was refunded.`,
          details: { ...(row.details ?? {}), late_result: raw },
        })
        .eq('id', row.id)
    } else {
      console.log('b2c callback for final withdrawal ignored', row.id, row.status)
    }
    return
  }

  if (kind === 'timeout') {
    const { error } = await admin.rpc('fail_withdrawal', {
      p_withdrawal_id: row.id,
      p_reason: 'M-Pesa did not process the payout in time',
      p_admin_user_id: null,
      p_raw: raw,
    })
    if (error) await logEdgeError(admin, 'withdrawals', 'fail_withdrawal.timeout', error, { code: error.code })
    else console.log('b2c timeout → refunded', row.id)
    return
  }

  if (parsed.outcome === 'completed') {
    if (parsed.amountKes != null && Number(row.net_kes) !== parsed.amountKes) {
      await logEdgeError(
        admin,
        'withdrawals',
        'b2c.amount_mismatch',
        `${row.id} paid ${parsed.amountKes} expected ${row.net_kes}`,
      )
      await admin
        .from('withdrawals')
        .update({
          admin_note: `REVIEW: B2C paid KES ${parsed.amountKes} but KES ${row.net_kes} was requested (receipt ${parsed.receipt ?? '?'}).`,
          result_code: String(parsed.resultCode),
          result_desc: parsed.resultDesc.slice(0, 300),
          details: { ...(row.details ?? {}), result: raw },
        })
        .eq('id', row.id)
      return
    }
    if (!parsed.receipt) {
      await logEdgeError(admin, 'withdrawals', 'b2c.success_without_receipt', row.id)
      await admin
        .from('withdrawals')
        .update({ admin_note: 'REVIEW: B2C reported success without a TransactionReceipt.', details: { ...(row.details ?? {}), result: raw } })
        .eq('id', row.id)
      return
    }
    const { error } = await admin.rpc('complete_withdrawal', {
      p_withdrawal_id: row.id,
      p_receipt: parsed.receipt,
      p_admin_user_id: null,
      p_note: null,
      p_raw: raw,
    })
    if (error) await logEdgeError(admin, 'withdrawals', 'complete_withdrawal', error, { code: error.code })
    else console.log('b2c completed', row.id, parsed.receipt)
    return
  }

  const { error } = await admin.rpc('fail_withdrawal', {
    p_withdrawal_id: row.id,
    p_reason: (parsed.resultDesc || 'M-Pesa rejected the payout').slice(0, 200),
    p_admin_user_id: null,
    p_raw: raw,
  })
  if (error) await logEdgeError(admin, 'withdrawals', 'fail_withdrawal.result', error, { code: error.code })
  else console.log('b2c failed → refunded', row.id, parsed.resultCode)
  const fresh = await loadWithdrawal(admin, row.id)
  if (fresh) console.log('b2c settled', row.id, fresh.status)
}

Deno.serve(async (req) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return new Response(JSON.stringify({ status: 'ok', service: 'mpesa-b2c-result' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (req.method !== 'POST') return accepted()

  const kind = new URL(req.url).searchParams.get('kind') === 'timeout' ? 'timeout' : 'result'
  let rawBody = ''
  try {
    const declared = Number(req.headers.get('content-length') ?? '0')
    if (declared <= MAX_BODY_BYTES) rawBody = await req.text()
  } catch {
    rawBody = ''
  }
  if (!rawBody || rawBody.length > MAX_BODY_BYTES) {
    console.log('b2c callback ignored', kind, rawBody ? 'too_large' : 'empty_body')
    return accepted()
  }

  EdgeRuntime.waitUntil(
    handle(rawBody, kind).catch(async (err) => {
      try {
        await logEdgeError(adminClient(), 'withdrawals', 'b2c.callback_process', err)
      } catch {
        console.error('b2c callback processing failed', String(err).slice(0, 200))
      }
    }),
  )
  return accepted()
})
