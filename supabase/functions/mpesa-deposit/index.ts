import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { MEGAPAY_PROVIDER } from "../_shared/megapay.ts";
import { withDirectDb } from "../_shared/direct-db.ts";
import {
  UNAVAILABLE_MESSAGE,
  adminClient,
  corsHeaders,
  credentialsConfigured,
  json,
  serverConfig,
  userFromRequest,
} from "../_shared/server.ts";
import {
  depositFeesFromMap,
  mergeMegapayConfig,
  parseQuickAmounts,
  type SettingsMap,
} from "../_shared/payments/payment-settings.ts";

/**
 * Config probe used by the deposit panel. Must not wait on PostgREST —
 * that path was timing out and leaving "Loading deposit options…".
 * LIVE rail is MegaPay; Daraja STK start stays disabled here.
 */
async function fastDepositView() {
  const base = serverConfig();
  try {
    return await withDirectDb(async (sql) => {
      const [settings, flags] = await Promise.all([
        sql`select key, value from public.payment_settings`,
        sql`select value from public.feature_flags where key = 'REAL_PAYMENTS_ENABLED' limit 1`,
      ]);
      const map: SettingsMap = {};
      for (const row of settings) {
        const key = String(row.key ?? "");
        if (key) map[key] = String(row.value ?? "");
      }
      const money = mergeMegapayConfig(base, map);
      const deposit = depositFeesFromMap(map, base);
      const flag = flags[0]?.value;
      return {
        enabled: flag === true || flag === "true" || flag === "t",
        kesPerUsd: money.kesPerUsd,
        minKes: money.minKes,
        maxKes: money.maxKes,
        quickAmounts: parseQuickAmounts(deposit.quickAmounts),
      };
    }, 4_000);
  } catch {
    console.error("mpesa-deposit", "config read skipped");
    return {
      enabled: true,
      kesPerUsd: base.kesPerUsd,
      minKes: base.minKes,
      maxKes: base.maxKes,
      quickAmounts: parseQuickAmounts(depositFeesFromMap({}, base).quickAmounts),
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = adminClient();
  const user = await userFromRequest(admin, req);
  if (!user) return json({ error: "Sign in to deposit." }, 401);

  if (req.method === "GET") {
    const cfg = await fastDepositView();
    const ready = cfg.enabled && credentialsConfigured(serverConfig());
    return json({
      provider: MEGAPAY_PROVIDER,
      enabled: ready,
      method: "mpesa",
      currency: "USD",
      paybill: null,
      kes_per_usd: cfg.kesPerUsd,
      min_kes: cfg.minKes,
      max_kes: cfg.maxKes,
      quick_amounts: cfg.quickAmounts,
      message: ready ? null : UNAVAILABLE_MESSAGE,
    });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  return json(
    { error: "Deposit method changed. Please reopen the deposit form." },
    409,
  );
});
