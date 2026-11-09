import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  MEGAPAY_PROVIDER,
  generateDepositReference,
  kesToUsd,
  maskPhone,
  normalizeKenyanPhone,
  validateAmountKes,
} from "../_shared/megapay.ts";
import { realAccountShort } from "../_shared/branding.ts";
import { parseDepositProvider } from "../_shared/daraja.ts";
import { withDirectDb } from "../_shared/direct-db.ts";
import {
  DEPOSIT_COLUMNS,
  UNAVAILABLE_MESSAGE,
  adminClient,
  claimMegapayAccount,
  corsHeaders,
  credentialsConfigured,
  initiateStk,
  json,
  loadPaymentSettingsMap,
  logEdgeError,
  publicDeposit,
  realPaymentsEnabled,
  resolveServerConfig,
  serverConfig,
  userFromRequest,
  type DepositRow,
} from "../_shared/server.ts";
import {
  depositFeesFromMap,
  mergeMegapayConfig,
  parseQuickAmounts,
  type SettingsMap,
} from "../_shared/payments/payment-settings.ts";

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_PENDING = 3;

/** Avoid PostgREST for the deposit form config probe. */
async function fastMegapayConfig() {
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
      const enabled = flag === true || flag === "true" || flag === "t";
      const provider = parseDepositProvider(
        map.DEPOSIT_PROVIDER || Deno.env.get("DEPOSIT_PROVIDER"),
      );
      return {
        provider,
        enabled,
        kesPerUsd: money.kesPerUsd,
        minKes: money.minKes,
        maxKes: money.maxKes,
        quickAmounts: parseQuickAmounts(deposit.quickAmounts),
      };
    }, 4_000);
  } catch {
    console.error("megapay-deposit", "config read skipped");
    return {
      provider: MEGAPAY_PROVIDER,
      enabled: true,
      kesPerUsd: base.kesPerUsd,
      minKes: base.minKes,
      maxKes: base.maxKes,
      quickAmounts: parseQuickAmounts(depositFeesFromMap({}, base).quickAmounts),
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();
  const user = await userFromRequest(admin, req);
  if (!user) return json({ error: "Sign in to deposit." }, 401);

  if (req.method === "GET") {
    const view = await fastMegapayConfig();
    const configured = credentialsConfigured(serverConfig());
    if (view.provider !== MEGAPAY_PROVIDER) {
      return json({ provider: view.provider });
    }
    const ready = view.enabled && configured;
    return json({
      enabled: ready,
      provider: MEGAPAY_PROVIDER,
      method: "mpesa",
      currency: "USD",
      kes_per_usd: view.kesPerUsd,
      min_kes: view.minKes,
      max_kes: view.maxKes,
      quick_amounts: view.quickAmounts,
      message: ready ? null : UNAVAILABLE_MESSAGE,
    });
  }

  const cfg = await resolveServerConfig(admin);
  const enabled = await realPaymentsEnabled(admin);
  const configured = credentialsConfigured(cfg);
  const settings = await loadPaymentSettingsMap(admin);
  const activeProvider = parseDepositProvider(
    settings.DEPOSIT_PROVIDER || Deno.env.get("DEPOSIT_PROVIDER"),
  );

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (activeProvider !== MEGAPAY_PROVIDER) {
    return json(
      { error: "Deposit method changed. Please reopen the deposit form." },
      409,
    );
  }
  if (!configured) return json({ error: UNAVAILABLE_MESSAGE }, 503);
  if (!enabled)
    return json(
      { error: `${realAccountShort()} deposits are not enabled yet.` },
      403,
    );

  const { loadUserAccess } = await import("../_shared/user-access.ts");
  const access = await loadUserAccess(admin, user.id);
  if (!access || access.accountStatus === "suspended") {
    return json({ error: "This account cannot deposit right now." }, 403);
  }
  if (!access.depositsEnabled) {
    return json(
      { error: "Deposits are turned off for this account. Contact support." },
      403,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const amount = validateAmountKes(body.amount_kes, cfg);
  if (!amount.ok) return json({ error: amount.error }, 400);
  const msisdn = normalizeKenyanPhone(String(body.phone ?? ""));
  if (!msisdn)
    return json(
      { error: "Enter a valid Safaricom M-Pesa number, e.g. 0712345678." },
      400,
    );

  let wallet: {
    id: string;
    account_id: string;
    currency: string;
    is_simulated: boolean;
  } | null = null;
  let pendingCount = 0;
  try {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const lookedUp = await withDirectDb(async (sql) => {
      const wallets = await sql`
        select id, account_id, currency, is_simulated
          from public.wallets
         where user_id = ${user.id}::uuid
           and account_mode = 'real'
           and is_simulated = false
         limit 1
      `;
      const pending = await sql`
        select count(*)::int as n
          from public.deposits
         where user_id = ${user.id}::uuid
           and provider = ${MEGAPAY_PROVIDER}
           and status = 'PENDING'
           and created_at >= ${since}::timestamptz
      `;
      return {
        wallet: (wallets[0] as {
          id: string;
          account_id: string;
          currency: string;
          is_simulated: boolean;
        } | undefined) ?? null,
        pending: Number(pending[0]?.n ?? 0),
      };
    }, 4_000);
    wallet = lookedUp.wallet;
    pendingCount = lookedUp.pending;
  } catch {
    console.error("megapay-deposit", "wallet read timed out");
    return json({ error: UNAVAILABLE_MESSAGE }, 503);
  }
  if (!wallet) {
    return json(
      {
        error: `Your ${realAccountShort()} wallet is not ready yet. Please contact support.`,
      },
      409,
    );
  }

  if (pendingCount >= RATE_LIMIT_MAX_PENDING) {
    return json(
      {
        error:
          "You have several deposits waiting for M-Pesa. Please wait a few minutes and try again.",
      },
      429,
    );
  }

  const amountUsd = kesToUsd(amount.amountKes, cfg.kesPerUsd);
  if (amountUsd <= 0) return json({ error: "Amount is too small." }, 400);

  const megapayAccount = await claimMegapayAccount(admin, cfg, settings);
  if (!megapayAccount) {
    return json(
      { error: "No MegaPay account is enabled. Turn one on in Fees → Pay mode." },
      503,
    );
  }

  let deposit: DepositRow | null = null;
  for (let attempt = 0; attempt < 3 && !deposit; attempt++) {
    const reference = generateDepositReference();
    const { data, error } = await admin
      .from("deposits")
      .insert({
        user_id: user.id,
        account_id: wallet.account_id,
        account_mode: "real",
        wallet_id: wallet.id,
        amount: amountUsd,
        currency: wallet.currency || "USD",
        method: "mpesa",
        status: "PENDING",
        provider: MEGAPAY_PROVIDER,
        is_simulated: false,
        details: {
          reference,
          amount_kes: amount.amountKes,
          rate: cfg.kesPerUsd,
          phone_masked: maskPhone(msisdn),
          megapay_account: megapayAccount.id,
          initiated_at: new Date().toISOString(),
        },
      })
      .select(DEPOSIT_COLUMNS)
      .single();
    if (data) deposit = data as DepositRow;
    else if (error?.code !== "23505") {
      await logEdgeError(admin, "deposits", "megapay-deposit.insert", error, {
        code: error?.code,
        userId: user.id,
      });
      return json({ error: UNAVAILABLE_MESSAGE }, 500);
    }
  }
  if (!deposit) return json({ error: UNAVAILABLE_MESSAGE }, 500);
  const reference = String(deposit.details.reference);

  let requestId: string | null = null;
  let failure: { kind: string; reason: string; raw: unknown } | null = null;
  try {
    const res = await initiateStk(megapayAccount, amount.amountKes, msisdn, reference);
    const id = res.body.transaction_request_id;
    if (
      res.httpStatus >= 200 &&
      res.httpStatus < 300 &&
      typeof id === "string" &&
      id.trim()
    ) {
      requestId = id.trim();
    } else {
      failure = {
        kind: "initiation_failed",
        reason: String(
          res.body.massage ?? res.body.message ?? "STK push rejected",
        ),
        raw: res.body,
      };
    }
  } catch (err) {
    failure = {
      kind: "expired",
      reason: "M-Pesa request timed out",
      raw: { error: String(err) },
    };
  }

  if (!requestId) {
    await logEdgeError(
      admin,
      "deposits",
      "megapay-deposit.initiatestk",
      failure?.reason ?? "STK push rejected",
      {
        code: failure?.kind ?? null,
        userId: user.id,
      },
    );
    await admin.rpc("fail_megapay_deposit", {
      p_deposit_id: deposit.id,
      p_status: "FAILED",
      p_kind: failure?.kind ?? "initiation_failed",
      p_reason: failure?.reason ?? "STK push rejected",
      p_raw: failure?.raw ?? {},
    });
    return json(
      {
        error:
          "We could not send the M-Pesa prompt. Check the number and try again.",
        deposit_id: deposit.id,
        status: "FAILED",
      },
      502,
    );
  }

  const { error: updateError } = await admin
    .from("deposits")
    .update({
      provider_reference: requestId,
      details: { ...deposit.details, megapay_request_id: requestId },
    })
    .eq("id", deposit.id);
  if (updateError) {
    await logEdgeError(
      admin,
      "deposits",
      "megapay-deposit.store_request_id",
      updateError,
      {
        code: updateError.code,
        userId: user.id,
      },
    );
  }

  return json({
    ...publicDeposit({ ...deposit, provider_reference: requestId }),
    status: "PENDING",
    message: "Check your phone and enter your M-Pesa PIN.",
  });
});
