/** Member/public UI must never show raw provider/DB/edge errors. */

const TECH =
  /supabase|postgres|postgrest|pgrst|jwt|rpc\b|edge function|webhook|daraja|megapay|oauth|idempotenc|checkout_request|provider_reference|system_issues|42p01|auth session|pkce|code verifier|allow-list|market data provider|trade-execution|payment provider|backend|frontend|not connected|realtradingprovider|demotradingprovider|configured provider|settlement is created|wallet debit/i

export function safeUserMessage(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text || text.length > 280 || TECH.test(text)) return fallback
  if (/^[A-Z0-9_.-]{3,40}$/.test(text) && text.includes('_')) return fallback
  return text
}
