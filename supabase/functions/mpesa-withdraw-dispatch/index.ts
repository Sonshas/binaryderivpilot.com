import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { DarajaAuthError } from '../_shared/daraja-server.ts'
import { maskPhone } from '../_shared/megapay.ts'
import { adminClient, corsHeaders, json, logEdgeError } from '../_shared/server.ts'
import {
  WITHDRAWAL_COLUMNS,
  b2cActive,
  b2cConfigured,
  b2cPaymentRequest,
  resolveWithdrawConfig,
  type WithdrawalRow,
} from '../_shared/withdraw-server.ts'

const BATCH = 10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method === 'GET' || req.method === 'HEAD') return json({ status: 'ok', service: 'mpesa-withdraw-dispatch' })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const sweepSecret = req.headers.get('x-sweep-secret')
  if (!sweepSecret) return json({ error: 'Unauthorized' }, 401)
  const { data: valid } = await admin.rpc('verify_real_trade_sweep_secret', { p_secret: sweepSecret })
  if (valid !== true) return json({ error: 'Unauthorized' }, 401)

  const cfg = await resolveWithdrawConfig(admin)
  if (!b2cActive(cfg)) {
    const reason = cfg.mode !== 'daraja_b2c' ? `mode=${cfg.mode}` : 'B2C not configured'
    console.log('withdraw dispatch skipped:', reason)
    return json({ mode: cfg.mode, configured: b2cConfigured(cfg), dispatched: 0, skipped: reason })
  }

  const { data, error } = await admin
    .from('withdrawals')
    .select(WITHDRAWAL_COLUMNS)
    .eq('account_mode', 'real')
    .eq('is_simulated', false)
    .eq('status', 'PENDING')
    .is('conversation_id', null)
    .order('created_at', { ascending: true })
    .limit(BATCH)
  if (error) {
    await logEdgeError(admin, 'withdrawals', 'withdraw-dispatch.query', error, { code: error.code })
    return json({ error: 'query failed' }, 500)
  }

  const results: Array<{ id: string; outcome: string }> = []
  for (const row of (data ?? []) as WithdrawalRow[]) {
    if (!row.msisdn || !row.net_kes || !row.reference) {
      results.push({ id: row.id, outcome: 'skipped_incomplete_row' })
      continue
    }
    const { data: claimed, error: claimError } = await admin.rpc('mark_withdrawal_processing', {
      p_withdrawal_id: row.id,
      p_admin_user_id: null,
      p_note: 'Sent via Daraja B2C',
      p_provider: 'daraja_b2c',
      p_conversation_id: null,
    })
    if (claimError || (claimed as Record<string, unknown> | null)?.already === true) {
      results.push({ id: row.id, outcome: claimError ? `claim_failed: ${claimError.message.slice(0, 80)}` : 'already_processing' })
      continue
    }

    try {
      const res = await b2cPaymentRequest(cfg, { reference: row.reference, amountKes: Number(row.net_kes), msisdn: row.msisdn })
      const conversationId = typeof res.body.ConversationID === 'string' ? res.body.ConversationID.trim() : ''
      const accepted = res.httpStatus >= 200 && res.httpStatus < 300 && String(res.body.ResponseCode ?? '') === '0' && conversationId
      if (accepted) {
        await admin
          .from('withdrawals')
          .update({ conversation_id: conversationId, details: { ...(row.details ?? {}), b2c_accepted_at: new Date().toISOString() } })
          .eq('id', row.id)
        console.log('b2c sent', row.id, maskPhone(row.msisdn), row.net_kes, conversationId)
        results.push({ id: row.id, outcome: 'sent' })
        continue
      }

      const duplicate = String(res.body.errorCode ?? '') === '500.002.1001'
      if (duplicate) {
        await logEdgeError(admin, 'withdrawals', 'b2c.duplicate_originator', row.id)
        await admin
          .from('withdrawals')
          .update({ admin_note: 'B2C reported a duplicate OriginatorConversationID — check the M-Pesa portal before acting.' })
          .eq('id', row.id)
        results.push({ id: row.id, outcome: 'duplicate_review' })
        continue
      }

      const reason = String(res.body.errorMessage ?? res.body.ResponseDescription ?? 'M-Pesa rejected the payout request').slice(0, 200)
      const { error: failError } = await admin.rpc('fail_withdrawal', {
        p_withdrawal_id: row.id,
        p_reason: reason,
        p_admin_user_id: null,
        p_raw: { source: 'daraja_b2c_request', http_status: res.httpStatus, body: res.body },
      })
      if (failError) {
        await logEdgeError(admin, 'withdrawals', 'fail_withdrawal.after_b2c_reject', failError, {
          code: failError.code,
        })
      }
      console.log('b2c rejected', row.id, res.httpStatus, reason)
      results.push({ id: row.id, outcome: 'rejected_refunded' })
    } catch (err) {
      if (err instanceof DarajaAuthError) {
        const { error: failError } = await admin.rpc('fail_withdrawal', {
          p_withdrawal_id: row.id,
          p_reason: 'M-Pesa authorization failed',
          p_admin_user_id: null,
          p_raw: { source: 'daraja_b2c_oauth', oauth_status: err.httpStatus },
        })
        if (failError) {
          await logEdgeError(admin, 'withdrawals', 'fail_withdrawal.after_oauth', failError, {
            code: failError.code,
          })
        }
        await logEdgeError(admin, 'withdrawals', 'b2c.oauth_failed', err, {
          code: String(err.httpStatus),
        })
        results.push({ id: row.id, outcome: 'oauth_failed_refunded' })
      } else {
        await logEdgeError(admin, 'withdrawals', 'b2c.request_ambiguous', err)
        await admin
          .from('withdrawals')
          .update({ admin_note: 'B2C request timed out — check the M-Pesa portal (B2C statement) before completing or failing.' })
          .eq('id', row.id)
        results.push({ id: row.id, outcome: 'ambiguous_review' })
      }
    }
  }

  if (results.length) console.log('withdraw dispatch', JSON.stringify(results))
  return json({ mode: cfg.mode, configured: true, dispatched: results.filter((r) => r.outcome === 'sent').length, results })
})
