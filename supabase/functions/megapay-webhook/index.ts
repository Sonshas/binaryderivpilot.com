import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  MEGAPAY_PROVIDER,
  classifyMegapayStatus,
  decideWebhookRoute,
  extractWebhookFields,
  isJsonObject,
  isOmtReference,
  type WebhookFields,
} from '../_shared/megapay.ts'
import { findMegapayDeposit, insertWebhookEvent, markWebhookProcessed, setDepositProviderReference } from '../_shared/direct-money.ts'
import {
  DEPOSIT_COLUMNS,
  adminClient,
  credentialsConfigured,
  loadDeposit,
  logEdgeError,
  reconcileDeposit,
  resolveMegapayCreds,
  serverConfig,
  transactionStatus,
  type DepositRow,
  type ServerConfig,
} from '../_shared/server.ts'

const MAX_BODY_BYTES = 64 * 1024
const FORWARD_TIMEOUT_MS = 8_000
const MAX_FORWARD_ATTEMPTS = 5
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000
const RETRY_MIN_GAP_MS = 60 * 1000

function ok(body: Record<string, unknown> = { status: 'received' }) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

async function findOurDeposit(admin: SupabaseClient, fields: WebhookFields): Promise<DepositRow | null> {
  try {
    const row = await findMegapayDeposit({
      transactionId: fields.transactionId,
      reference: isOmtReference(fields.reference) ? fields.reference!.trim().toUpperCase() : null,
    })
    return (row as DepositRow | null) ?? null
  } catch (err) {
    console.error('megapay-webhook.find', err instanceof Error ? err.message : 'error')
  }
  if (fields.transactionId) {
    const { data } = await admin
      .from('deposits')
      .select(DEPOSIT_COLUMNS)
      .eq('provider', MEGAPAY_PROVIDER)
      .eq('provider_reference', fields.transactionId)
      .maybeSingle()
    if (data) return data as DepositRow
  }
  if (isOmtReference(fields.reference)) {
    const { data } = await admin
      .from('deposits')
      .select(DEPOSIT_COLUMNS)
      .eq('provider', MEGAPAY_PROVIDER)
      .eq('details->>reference', fields.reference!.trim().toUpperCase())
      .maybeSingle()
    if (data) return data as DepositRow
  }
  return null
}

async function processOurs(admin: SupabaseClient, cfg: ServerConfig, eventId: string, fields: WebhookFields, found: DepositRow | null) {
  let result = 'no_matching_deposit'
  try {
    let deposit = found
    const creds = deposit ? resolveMegapayCreds(cfg, deposit.details?.megapay_account) : null
    if (deposit && !deposit.provider_reference && fields.transactionId && creds) {
      const status = await transactionStatus(creds, fields.transactionId)
      const verified = classifyMegapayStatus(status.body)
      if (verified.reference?.toUpperCase() === String(deposit.details?.reference)) {
        try {
          await setDepositProviderReference(deposit.id, fields.transactionId)
        } catch (err) {
          console.error('megapay-webhook.reference', err instanceof Error ? err.message : 'error')
        }
        deposit = await loadDeposit(admin, deposit.id)
      } else {
        result = 'reference_not_verified'
        deposit = null
      }
    }
    if (deposit) {
      const settled = await reconcileDeposit(admin, cfg, deposit)
      result = `deposit_${settled.status.toLowerCase()}`
    }
  } catch (err) {
    result = `error: ${String(err).slice(0, 200)}`
  }
  try {
    await markWebhookProcessed(eventId, result)
  } catch (err) {
    console.error('megapay-webhook.processed', err instanceof Error ? err.message : 'error')
    await admin.from('megapay_webhook_events').update({ processed: true, process_result: result }).eq('id', eventId)
  }
}

async function forwardEvent(admin: SupabaseClient, cfg: ServerConfig, event: { id: string; raw_body: string; content_type: string | null }) {
  let forwardStatus: number | null = null
  let forwardError: string | null = null
  try {
    const res = await fetch(cfg.vastWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': event.content_type || 'application/json' },
      body: event.raw_body,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    })
    forwardStatus = res.status
    if (!res.ok) forwardError = (await res.text()).slice(0, 300)
    else await res.body?.cancel()
  } catch (err) {
    forwardError = String(err).slice(0, 300)
  }
  await admin
    .from('megapay_webhook_events')
    .update({ forward_status: forwardStatus, forward_error: forwardError, processed: forwardStatus != null && forwardStatus < 300 })
    .eq('id', event.id)
}

async function retryUnforwarded(admin: SupabaseClient, cfg: ServerConfig, excludeId: string) {
  const now = Date.now()
  const { data } = await admin
    .from('megapay_webhook_events')
    .select('id, raw_body, content_type, attempts, last_attempt_at')
    .eq('routed_to', 'vast')
    .neq('id', excludeId)
    .lt('attempts', MAX_FORWARD_ATTEMPTS)
    .gte('received_at', new Date(now - RETRY_WINDOW_MS).toISOString())
    .lt('last_attempt_at', new Date(now - RETRY_MIN_GAP_MS).toISOString())
    .or('forward_status.is.null,forward_status.lt.200,forward_status.gte.300')
    .order('received_at', { ascending: true })
    .limit(5)
  for (const event of data ?? []) {
    const { data: claimed } = await admin
      .from('megapay_webhook_events')
      .update({ attempts: event.attempts + 1, last_attempt_at: new Date().toISOString() })
      .eq('id', event.id)
      .eq('attempts', event.attempts)
      .select('id')
    if (claimed?.length) await forwardEvent(admin, cfg, event)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'GET' || req.method === 'HEAD') return ok({ status: 'ok', service: 'megapay-webhook' })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return new Response('Payload too large', { status: 413 })
  const rawBody = await req.text()
  if (rawBody.length > MAX_BODY_BYTES) return new Response('Payload too large', { status: 413 })

  let payload: unknown = null
  try {
    payload = JSON.parse(rawBody)
  } catch {
    payload = null
  }

  const cfg = serverConfig()
  const admin = adminClient()
  const fields = extractWebhookFields(payload)
  const ours = isJsonObject(payload) ? await findOurDeposit(admin, fields) : null
  const route = decideWebhookRoute(payload, fields, ours != null)
  const contentType = req.headers.get('content-type')

  let event: { id: string } | null = null
  try {
    const id = await insertWebhookEvent({
      payload: isJsonObject(payload) ? payload : null,
      rawBody,
      contentType,
      reference: fields.reference,
      transactionId: fields.transactionId,
      routedTo: route,
      attempts: route === 'vast' ? 1 : 0,
      lastAttemptAt: route === 'vast' ? new Date().toISOString() : null,
      processed: route === 'unknown',
      processResult: route === 'unknown' ? (rawBody.trim() ? 'not_json_object' : 'empty_body') : null,
    })
    if (id) event = { id }
  } catch (err) {
    console.error('megapay-webhook.insert', err instanceof Error ? err.message : 'error')
  }
  if (!event) {
    const error = new Error('webhook insert failed')
    await logEdgeError(admin, 'deposits', 'megapay-webhook.insert', error, {})
    if (route === 'vast') {
      await fetch(cfg.vastWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': contentType || 'application/json' },
        body: rawBody,
        signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
      }).catch((err) => {
        void logEdgeError(admin, 'deposits', 'megapay-webhook.direct_forward', err)
      })
    }
    return ok()
  }

  const work = (async () => {
    if (route === 'omt') await processOurs(admin, cfg, event.id, fields, ours)
    else if (route === 'vast') await forwardEvent(admin, cfg, { id: event.id, raw_body: rawBody, content_type: contentType })
    await retryUnforwarded(admin, cfg, event.id)
  })().catch((err) => {
    void logEdgeError(admin, 'deposits', 'megapay-webhook.background', err)
  })

  EdgeRuntime.waitUntil(work)
  return ok()
})
