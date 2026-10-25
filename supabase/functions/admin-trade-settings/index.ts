import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { isAdmin } from "../_shared/admin-staff.ts";
import {
  adminClient,
  corsHeaders,
  json,
  logEdgeError,
  userFromRequest,
} from "../_shared/server.ts";

const KEYS = {
  payoutPercent: "TRADE_PAYOUT_PERCENT",
  demoWinRatePercent: "DEMO_WIN_RATE_PERCENT",
  realWinRatePercent: "REAL_WIN_RATE_PERCENT",
  vipWinRatePercent: "VIP_WIN_RATE_PERCENT",
  scannerWinRatePercent: "SCANNER_WIN_RATE_PERCENT",
} as const;

const DEFAULTS = {
  payoutPercent: 95.22,
  demoWinRatePercent: 90,
  realWinRatePercent: 90,
  vipWinRatePercent: 90,
  scannerWinRatePercent: 90,
};

type OutcomeSettings = typeof DEFAULTS;

function clamp(value: unknown, fallback: number, max: number): number {
  const n = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(n) || n < 0 || n > max) return fallback;
  return n;
}

function normalize(raw: Record<string, string>): OutcomeSettings {
  return {
    payoutPercent: clamp(raw[KEYS.payoutPercent], DEFAULTS.payoutPercent, 500),
    demoWinRatePercent: clamp(
      raw[KEYS.demoWinRatePercent],
      DEFAULTS.demoWinRatePercent,
      100,
    ),
    realWinRatePercent: clamp(
      raw[KEYS.realWinRatePercent],
      DEFAULTS.realWinRatePercent,
      100,
    ),
    vipWinRatePercent: clamp(
      raw[KEYS.vipWinRatePercent],
      DEFAULTS.vipWinRatePercent,
      100,
    ),
    scannerWinRatePercent: clamp(
      raw[KEYS.scannerWinRatePercent],
      DEFAULTS.scannerWinRatePercent,
      100,
    ),
  };
}

async function loadMap(
  admin: ReturnType<typeof adminClient>,
): Promise<Record<string, string>> {
  const { data, error } = await admin
    .from("trading_settings")
    .select("key, value");
  if (error) throw new Error(error.message);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    const key = String((row as { key?: unknown }).key ?? "");
    if (!key) continue;
    map[key] = String((row as { value?: unknown }).value ?? "");
  }
  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST")
    return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();
  const user = await userFromRequest(admin, req);
  if (!user) return json({ error: "Sign in as an admin." }, 401);
  if (!isAdmin(user)) return json({ error: "Forbidden" }, 403);

  try {
    if (req.method === "GET") {
      const settings = normalize(await loadMap(admin));
      return json({ ok: true, settings });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }

    const settings: OutcomeSettings = {
      payoutPercent: clamp(body.payoutPercent, DEFAULTS.payoutPercent, 500),
      demoWinRatePercent: clamp(
        body.demoWinRatePercent,
        DEFAULTS.demoWinRatePercent,
        100,
      ),
      realWinRatePercent: clamp(
        body.realWinRatePercent,
        DEFAULTS.realWinRatePercent,
        100,
      ),
      vipWinRatePercent: clamp(
        body.vipWinRatePercent,
        DEFAULTS.vipWinRatePercent,
        100,
      ),
      scannerWinRatePercent: clamp(
        body.scannerWinRatePercent,
        DEFAULTS.scannerWinRatePercent,
        100,
      ),
    };

    const now = new Date().toISOString();
    const rows = [
      {
        key: KEYS.payoutPercent,
        value: settings.payoutPercent,
        description: "Profit percent on a win (admin Trade settings).",
        updated_at: now,
      },
      {
        key: KEYS.demoWinRatePercent,
        value: settings.demoWinRatePercent,
        description: "Demo settlement win rate percent.",
        updated_at: now,
      },
      {
        key: KEYS.realWinRatePercent,
        value: settings.realWinRatePercent,
        description: "Real settlement win rate percent.",
        updated_at: now,
      },
      {
        key: KEYS.vipWinRatePercent,
        value: settings.vipWinRatePercent,
        description: "VIP settlement win rate percent.",
        updated_at: now,
      },
      {
        key: KEYS.scannerWinRatePercent,
        value: settings.scannerWinRatePercent,
        description: "Scanner settlement win rate percent.",
        updated_at: now,
      },
    ];
    const { error } = await admin
      .from("trading_settings")
      .upsert(rows, { onConflict: "key" });
    if (error) throw new Error(error.message);

    return json({ ok: true, message: "Trade settings saved.", settings });
  } catch (err) {
    await logEdgeError(admin, "admin", "admin-trade-settings", err);
    return json({ error: "Could not save trade settings." }, 500);
  }
});
