import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { realAccountShort } from "../_shared/branding.ts";
import { maskPhone, normalizeKenyanPhone } from "../_shared/megapay.ts";
import {
  adminClient,
  corsHeaders,
  json,
  logEdgeError,
  userFromRequest,
} from "../_shared/server.ts";
import {
  b2cActive,
  hasSettledRealTrade,
  loadWithdrawal,
  publicWithdrawal,
  requestErrorMessage,
  resolveWithdrawConfig,
} from "../_shared/withdraw-server.ts";
import {
  NO_REAL_TRADE_MESSAGE,
  generateWithdrawalReference,
  minUsdFor,
  processingTimeCopy,
  validateWithdrawalAmountUsd,
} from "../_shared/withdrawals.ts";
import { callRequestWithdrawal, readFlag, readRealWallet } from "../_shared/direct-money.ts";
import { loadUserAccess } from "../_shared/user-access.ts";

const UNAVAILABLE = "Withdrawals temporarily unavailable";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();
  const user = await userFromRequest(admin, req);
  if (!user) return json({ error: "Sign in to withdraw." }, 401);
  const cfg = await resolveWithdrawConfig(admin);

  let enabled = true;
  try {
    const flag = await readFlag("REAL_WITHDRAWALS_ENABLED");
    enabled = flag == null || flag === true;
  } catch (err) {
    console.error(
      "withdraw.flag",
      err instanceof Error ? err.message : "error",
    );
    try {
      const { data: flag } = await admin
        .from("feature_flags")
        .select("value")
        .eq("key", "REAL_WITHDRAWALS_ENABLED")
        .maybeSingle();
      enabled = flag == null || flag.value === true;
    } catch {
      enabled = true;
    }
  }
  const activeMode = b2cActive(cfg) ? "daraja_b2c" : "manual";

  if (req.method === "GET") {
    const hasRealTrade = await hasSettledRealTrade(admin, user.id);
    return json({
      enabled,
      has_real_trade: hasRealTrade,
      eligibility_message: hasRealTrade ? null : NO_REAL_TRADE_MESSAGE,
      mode: activeMode,
      method: "mpesa",
      currency: "USD",
      kes_per_usd: cfg.kesPerUsd,
      min_kes: cfg.minKes,
      max_kes: cfg.maxKes,
      min_usd: minUsdFor(cfg),
      fee_kes: cfg.feeKes,
      processing_copy: processingTimeCopy(activeMode),
      message: enabled
        ? null
        : "Withdrawals are paused for maintenance. Please try again later.",
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!enabled)
    return json(
      {
        error:
          "Withdrawals are paused for maintenance. Please try again later.",
      },
      503,
    );

  const access = await loadUserAccess(admin, user.id);
  if (!access || access.accountStatus === "suspended") {
    return json({ error: "This account cannot withdraw right now." }, 403);
  }
  if (!access.withdrawalsEnabled) {
    return json(
      {
        error: "Withdrawals are turned off for this account. Contact support.",
      },
      403,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const msisdn = normalizeKenyanPhone(String(body.phone ?? ""));
  if (!msisdn)
    return json(
      { error: "Enter a valid Safaricom M-Pesa number, e.g. 0712345678." },
      400,
    );
  if (!(await hasSettledRealTrade(admin, user.id)))
    return json({ error: NO_REAL_TRADE_MESSAGE }, 403);

  let wallet: {
    id: string;
    available_balance: number | string;
    currency: string;
    status: string;
  } | null = null;
  try {
    const row = await readRealWallet(user.id);
    if (row) {
      wallet = {
        id: String(row.id),
        available_balance: row.available_balance as number | string,
        currency: String(row.currency ?? "USD"),
        status: String(row.status ?? ""),
      };
    }
  } catch (err) {
    console.error(
      "withdraw.wallet",
      err instanceof Error ? err.message : "error",
    );
  }
  if (!wallet) {
    const { data, error: walletError } = await admin
      .from("wallets")
      .select("id, available_balance, currency, status")
      .eq("user_id", user.id)
      .eq("account_mode", "real")
      .eq("is_simulated", false)
      .maybeSingle();
    if (!walletError && data) wallet = data;
  }
  if (!wallet) {
    return json(
      {
        error: `Your ${realAccountShort()} wallet is not ready yet. Please contact support.`,
      },
      409,
    );
  }

  const available = Number(wallet.available_balance);
  const amount = validateWithdrawalAmountUsd(
    body.amount_usd,
    cfg,
    Number.isFinite(available) ? available : null,
  );
  if (!amount.ok) return json({ error: amount.error }, 400);

  let result: Record<string, unknown> | null = null;
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3 && !result; attempt++) {
    const reference = generateWithdrawalReference();
    try {
      result = await callRequestWithdrawal({
        userId: user.id,
        amountUsd: amount.amountUsd,
        msisdn,
        kesPerUsd: cfg.kesPerUsd,
        feeKes: cfg.feeKes,
        minKes: cfg.minKes,
        maxKes: cfg.maxKes,
        provider: activeMode,
        reference,
      });
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "unknown";
      const code = err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code ?? "")
        : "";
      if (code !== "23505" && !/duplicate key|withdrawals_reference_uniq/i.test(lastError)) {
        break;
      }
    }
  }

  if (!result) {
    const mapped = requestErrorMessage(lastError ?? "", cfg);
    if (mapped.status >= 500) {
      await logEdgeError(
        admin,
        "withdrawals",
        "request_real_withdrawal",
        lastError ?? "unknown",
        {
          userId: user.id,
        },
      );
    } else
      console.log("withdrawal rejected", user.id, mapped.status, lastError);
    return json(
      { error: mapped.status >= 500 ? UNAVAILABLE : mapped.error },
      mapped.status,
    );
  }

  const id = String(result.withdrawal_id);
  const row = await loadWithdrawal(admin, id);
  console.log(
    "withdrawal requested",
    id,
    maskPhone(msisdn),
    result.net_kes,
    activeMode,
  );

  if (!row)
    return json({
      withdrawal_id: id,
      reference: result.reference,
      status: "PENDING",
    });
  return json({
    ...publicWithdrawal(row),
    mode: activeMode,
    processing_copy: processingTimeCopy(activeMode),
    message: "Request received.",
  });
});
