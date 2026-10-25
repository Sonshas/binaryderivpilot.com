/**
 * One-off Daraja STK test using repo-root .env (no secrets logged).
 * Usage: node scripts/send-test-stk.mjs [phone] [amountKes]
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv(path) {
  const map = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 1) continue
    map[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return map
}

function normalizeKenyanPhone(input) {
  const digits = String(input ?? '')
    .replace(/[\s\-().]/g, '')
    .replace(/^\+/, '')
  if (!/^\d+$/.test(digits)) return null
  let local
  if (/^0[17]\d{8}$/.test(digits)) local = digits.slice(1)
  else if (/^[17]\d{8}$/.test(digits)) local = digits
  else if (/^254[17]\d{8}$/.test(digits)) local = digits.slice(3)
  else return null
  return `254${local}`
}

function nairobiTimestamp(date = new Date()) {
  const d = new Date(date.getTime() + 3 * 60 * 60 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

function uniqueRef() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let body = ''
  for (let i = 0; i < 8; i++) body += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `OMT-${body}`
}

const env = loadEnv(resolve(process.cwd(), '.env'))
const phoneArg = process.argv[2] || '0769648526'
const amountKes = Math.round(Number(process.argv[3] || 10))
const msisdn = normalizeKenyanPhone(phoneArg)
const shortcode = env.MPESA_SHORTCODE
const passkey = env.MPESA_PASSKEY
const consumerKey = env.MPESA_CONSUMER_KEY
const consumerSecret = env.MPESA_CONSUMER_SECRET
const callbackUrl = (env.MPESA_CALLBACK_URL || 'https://optionmarkettraders.com/api/mpesa/callback').replace(/\?.*$/, '')

if (!msisdn) {
  console.error('INVALID_PHONE')
  process.exit(1)
}
if (!shortcode || !passkey || !consumerKey || !consumerSecret) {
  console.error('MISSING_MPESA_ENV')
  process.exit(1)
}
if (!Number.isInteger(amountKes) || amountKes < 1) {
  console.error('INVALID_AMOUNT')
  process.exit(1)
}

const reference = uniqueRef()
const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')
const tokenRes = await fetch('https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
  headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
})
const tokenBody = await tokenRes.json().catch(() => ({}))
if (!tokenRes.ok || !tokenBody.access_token) {
  console.error('OAUTH_FAILED', tokenRes.status)
  process.exit(1)
}

const timestamp = nairobiTimestamp()
const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64')
const callbackWithRef = `${callbackUrl}?reference=${encodeURIComponent(reference)}`
const payload = {
  BusinessShortCode: shortcode,
  Password: password,
  Timestamp: timestamp,
  TransactionType: 'CustomerPayBillOnline',
  Amount: amountKes,
  PartyA: msisdn,
  PartyB: shortcode,
  PhoneNumber: msisdn,
  CallBackURL: callbackWithRef,
  AccountReference: reference.slice(0, 12),
  TransactionDesc: 'Deposit',
}

const stkRes = await fetch('https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${tokenBody.access_token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify(payload),
})
const stkBody = await stkRes.json().catch(() => ({}))
const ok =
  stkRes.status >= 200 &&
  stkRes.status < 300 &&
  String(stkBody.ResponseCode ?? '') === '0' &&
  typeof stkBody.CheckoutRequestID === 'string'

console.log(
  JSON.stringify(
    {
      ok,
      httpStatus: stkRes.status,
      responseCode: stkBody.ResponseCode ?? null,
      responseDescription: stkBody.ResponseDescription ?? stkBody.errorMessage ?? null,
      checkoutRequestId: stkBody.CheckoutRequestID ?? null,
      merchantRequestId: stkBody.MerchantRequestID ?? null,
      reference,
      amountKes,
      phoneMasked: `${msisdn.slice(0, 6)}***${msisdn.slice(-3)}`,
      accountReference: reference.slice(0, 12),
    },
    null,
    2,
  ),
)
process.exit(ok ? 0 : 1)
