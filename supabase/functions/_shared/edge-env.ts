/**
 * Custom Edge Function secrets are readable with Deno.env.get.
 * Deno.env.toObject() omits them, which made every deposit look unconfigured.
 */
const PAYMENT_ENV_KEYS = [
  "MEGAPAY_EMAIL",
  "MEGAPAY_EMAIL_WINSOFT",
  "MEGAPAY_EMAIL_VAST",
  "MEGAPAY_API_KEY",
  "MEGAPAY_API_KEY_WINSOFT",
  "MEGAPAY_API_KEY_VAST",
  "MEGAPAY_MIN_KES",
  "MEGAPAY_MAX_KES",
  "KES_PER_USD",
  "VAST_WEBHOOK_URL",
  "DEPOSIT_PROVIDER",
  "MPESA_SHORTCODE",
  "MPESA_PASSKEY",
  "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET",
  "MPESA_CALLBACK_URL",
  "MPESA_ACCOUNT_REFERENCE",
  "MPESA_B2C_SHORTCODE",
  "MPESA_INITIATOR_NAME",
  "MPESA_SECURITY_CREDENTIAL",
  "MPESA_B2C_RESULT_URL",
  "MPESA_B2C_TIMEOUT_URL",
  "WITHDRAWAL_MIN_KES",
  "WITHDRAWAL_MAX_KES",
  "WITHDRAWAL_FEE_KES",
  "WITHDRAWAL_MODE",
  "ADMIN_EMAILS",
  "VITE_ADMIN_EMAILS",
] as const;

export function readEdgeSecret(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (raw == null) return undefined;
  const cleaned = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "");
  return cleaned || undefined;
}

export function paymentEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  try {
    Object.assign(env, Deno.env.toObject());
  } catch {
    // Some isolates refuse a full dump. Named reads below still work.
  }
  for (const name of PAYMENT_ENV_KEYS) {
    const value = readEdgeSecret(name);
    if (value) env[name] = value;
  }
  return env;
}
