import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { realAccountShort } from "../_shared/branding.ts";
import {
  classifyStkQuery,
  DARAJA_PROVIDER,
  parseDepositProvider,
} from "../_shared/daraja.ts";
import {
  generateDepositReference,
  maskPhone,
  MEGAPAY_PROVIDER,
  normalizeKenyanPhone,
} from "../_shared/megapay.ts";
import {
  adminClient,
  claimMegapayAccount,
  credentialsConfigured,
  corsHeaders,
  DEPOSIT_COLUMNS,
  initiateStk,
  json,
  loadPaymentSettingsMap,
  logEdgeError,
  reconcileDeposit,
  resolveServerConfig,
  userFromRequest,
  type DepositRow,
} from "../_shared/server.ts";
import {
  DARAJA_DEPOSIT_COLUMNS,
  darajaConfig,
  darajaConfigured,
  findByCheckoutRequestId,
  reconcileDarajaDeposit,
  resolveDarajaConfig,
  stkPush,
  stkQuery,
  type DarajaDepositRow,
} from "../_shared/daraja-server.ts";
import {
  feeKesPerUsd,
  serviceKind,
  servicePaymentLabel,
  serviceStkCopy,
  serviceUsd,
} from "../_shared/service-charges.ts";

const MAX_STK_KES = 250_000;

const FEE_KEYS: Record<string, string> = {
  scanner: "SCANNER_FEE_KES",
  verification: "VERIFICATION_FEE_KES",
  tax: "TAX_FEE_KES",
};

async function storedAmount(kind: string): Promise<number | null> {
  const key = FEE_KEYS[kind] ?? FEE_KEYS.scanner;
  try {
    const admin = adminClient();
    const { data, error } = await admin
      .from("payment_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    const amount = Math.round(Number((data as { value?: unknown }).value));
    if (Number.isInteger(amount) && amount >= 1 && amount <= MAX_STK_KES)
      return amount;
    return null;
  } catch {
    return null;
  }
}

async function activeDepositProvider(
  admin: ReturnType<typeof adminClient>,
): Promise<"daraja" | "megapay"> {
  const map = await loadPaymentSettingsMap(admin);
  return parseDepositProvider(
    map.DEPOSIT_PROVIDER || Deno.env.get("DEPOSIT_PROVIDER"),
  );
}

async function findGateDeposit(
  admin: ReturnType<typeof adminClient>,
  ref: string,
): Promise<DepositRow | DarajaDepositRow | null> {
  const daraja = await findByCheckoutRequestId(admin, ref);
  if (daraja) return daraja;
  const { data } = await admin
    .from("deposits")
    .select(DEPOSIT_COLUMNS)
    .eq("provider_reference", ref)
    .maybeSingle();
  return (data as DepositRow | null) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();
  const user = await userFromRequest(admin, req);
  if (!user) return json({ error: "Sign in to pay with M-Pesa." }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const provider = await activeDepositProvider(admin);

  if (body.action === "status") {
    const checkout = String(body.checkout_request_id ?? "").trim();
    if (!checkout) return json({ error: "Missing M-Pesa reference." }, 400);
    const deposit = await findGateDeposit(admin, checkout);
    if (deposit) {
      if (deposit.provider === MEGAPAY_PROVIDER) {
        const megapayCfg = await resolveServerConfig(admin);
        const settled = await reconcileDeposit(admin, megapayCfg, deposit as DepositRow);
        if (settled.status === "COMPLETED")
          return json({ status: "COMPLETED", failure_reason: null });
        if (settled.status === "CANCELLED") {
          return json({
            status: "CANCELLED",
            failure_reason:
              (settled.details?.failure_reason as string) ?? "Cancelled",
          });
        }
        if (settled.status === "FAILED") {
          return json({
            status: "FAILED",
            failure_reason:
              (settled.details?.failure_reason as string) ?? "Failed",
          });
        }
        return json({ status: "PENDING", failure_reason: null });
      }

      const settled = await reconcileDarajaDeposit(
        admin,
        darajaConfig(),
        deposit as DarajaDepositRow,
      );
      if (settled.status === "COMPLETED")
        return json({ status: "COMPLETED", failure_reason: null });
      if (settled.status === "CANCELLED") {
        return json({
          status: "CANCELLED",
          failure_reason:
            (settled.details?.failure_reason as string) ?? "Cancelled",
        });
      }
      if (settled.status === "FAILED") {
        return json({
          status: "FAILED",
          failure_reason:
            (settled.details?.failure_reason as string) ?? "Failed",
        });
      }
      return json({ status: "PENDING", failure_reason: null });
    }

    // Legacy in-flight Daraja prompts (pre-deposits recording).
    const darajaCfg = await resolveDarajaConfig(admin);
    if (darajaConfigured(darajaCfg)) {
      const res = await stkQuery(darajaCfg, checkout);
      const query = classifyStkQuery(res.body, checkout);
      if (query.outcome === "completed")
        return json({ status: "COMPLETED", failure_reason: null });
      if (query.outcome === "cancelled")
        return json({ status: "CANCELLED", failure_reason: query.description });
      if (query.outcome === "failed")
        return json({ status: "FAILED", failure_reason: query.description });
    }
    return json({ status: "PENDING", failure_reason: null });
  }

  const kind = serviceKind(body.kind ?? "scanner");
  if (!kind)
    return json({ error: "That payment is not a service charge." }, 400);
  // Admin payment_settings (*_FEE_KES) is system-wide source of truth — ignore stale client amounts.
  const stored = await storedAmount(kind);
  const requested = Math.round(Number(body.amount_kes));
  const amountKes = stored ?? requested;
  if (
    !Number.isInteger(amountKes) ||
    amountKes < 1 ||
    amountKes > MAX_STK_KES
  ) {
    return json({ error: "That amount cannot be sent by M-Pesa." }, 400);
  }
  const msisdn = normalizeKenyanPhone(String(body.phone ?? ""));
  if (!msisdn)
    return json(
      { error: "Enter a valid Safaricom M-Pesa number, e.g. 0712345678." },
      400,
    );

  const { data: wallet, error: walletError } = await admin
    .from("wallets")
    .select("id, account_id, currency")
    .eq("user_id", user.id)
    .eq("account_mode", "real")
    .eq("is_simulated", false)
    .maybeSingle();
  if (walletError || !wallet) {
    return json(
      {
        error: `Your ${realAccountShort()} wallet is not ready yet. Please contact support.`,
      },
      409,
    );
  }

  const rate = await feeKesPerUsd(admin);
  const amountUsd = serviceUsd(amountKes, rate);
  if (amountUsd <= 0) return json({ error: "Amount is too small." }, 400);

  const copy = serviceStkCopy(kind);
  const payment = servicePaymentLabel(kind);

  if (provider === MEGAPAY_PROVIDER) {
    const megapayCfg = await resolveServerConfig(admin);
    if (!credentialsConfigured(megapayCfg)) {
      return json({ error: "M-Pesa is not connected on this site yet." }, 503);
    }
    const settingsMap = await loadPaymentSettingsMap(admin);
    const megapayAccount = await claimMegapayAccount(admin, megapayCfg, settingsMap);
    if (!megapayAccount) {
      return json(
        { error: "No MegaPay account is enabled. Turn one on in Fees → Pay mode." },
        503,
      );
    }

    let deposit: DepositRow | null = null;
    let reference = "";
    for (let attempt = 0; attempt < 3 && !deposit; attempt++) {
      reference = generateDepositReference();
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
            type: "service_charge",
            kind,
            payment,
            reference,
            amount_kes: amountKes,
            amount_usd: amountUsd,
            rate,
            phone_masked: maskPhone(msisdn),
            megapay_account: megapayAccount.id,
            account_reference: reference,
            initiated_at: new Date().toISOString(),
          },
        })
        .select(DEPOSIT_COLUMNS)
        .single();
      if (data) deposit = data as DepositRow;
      else if (error?.code !== "23505") {
        await logEdgeError(admin, "deposits", "scanner-stk.megapay.insert", error, {
          code: error?.code,
          userId: user.id,
        });
        return json(
          { error: "We could not start that payment. Please try again." },
          500,
        );
      }
    }
    if (!deposit || !reference) {
      return json(
        { error: "We could not start that payment. Please try again." },
        500,
      );
    }

    let requestId: string | null = null;
    let failReason = "STK push rejected";
    try {
      const res = await initiateStk(megapayAccount, amountKes, msisdn, reference);
      const id = res.body.transaction_request_id;
      if (
        res.httpStatus >= 200 &&
        res.httpStatus < 300 &&
        typeof id === "string" &&
        id.trim()
      ) {
        requestId = id.trim();
      } else {
        failReason = String(
          res.body.massage ?? res.body.message ?? "STK push rejected",
        );
      }
    } catch {
      failReason = "M-Pesa request timed out";
    }

    if (!requestId) {
      await logEdgeError(
        admin,
        "deposits",
        "scanner-stk.megapay.initiatestk",
        failReason,
        { userId: user.id },
      );
      await admin.rpc("fail_megapay_deposit", {
        p_deposit_id: deposit.id,
        p_status: "FAILED",
        p_kind: "initiation_failed",
        p_reason: failReason,
        p_raw: {},
      });
      return json(
        { error: "STK send failed, contact support for assistance" },
        502,
      );
    }

    const { error: updateError } = await admin
      .from("deposits")
      .update({
        provider_reference: requestId,
        details: {
          ...deposit.details,
          megapay_request_id: requestId,
        },
      })
      .eq("id", deposit.id);
    if (updateError) {
      await logEdgeError(
        admin,
        "deposits",
        "scanner-stk.megapay.store_request_id",
        updateError,
        { code: updateError.code, userId: user.id },
      );
    }

    console.log(
      "service charge megapay stk sent",
      kind,
      deposit.id,
      maskPhone(msisdn),
      amountKes,
    );
    return json({
      status: "PENDING",
      checkout_request_id: requestId,
      deposit_id: deposit.id,
      amount_kes: amountKes,
      provider: MEGAPAY_PROVIDER,
      message: "STK sent successfully",
    });
  }

  // Daraja pay mode
  const cfg = await resolveDarajaConfig(admin);
  if (!darajaConfigured(cfg)) {
    return json({ error: "M-Pesa is not connected on this site yet." }, 503);
  }

  let deposit: DarajaDepositRow | null = null;
  let reference = "";
  for (let attempt = 0; attempt < 3 && !deposit; attempt++) {
    reference = generateDepositReference();
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
        provider: DARAJA_PROVIDER,
        is_simulated: false,
        details: {
          type: "service_charge",
          kind,
          payment,
          reference,
          amount_kes: amountKes,
          amount_usd: amountUsd,
          rate,
          phone_masked: maskPhone(msisdn),
          paybill: cfg.shortcode,
          account_reference: reference,
          initiated_at: new Date().toISOString(),
        },
      })
      .select(DARAJA_DEPOSIT_COLUMNS)
      .single();
    if (data) deposit = data as DarajaDepositRow;
    else if (error?.code !== "23505") {
      await logEdgeError(admin, "deposits", "scanner-stk.insert", error, {
        code: error?.code,
        userId: user.id,
      });
      return json(
        { error: "We could not start that payment. Please try again." },
        500,
      );
    }
  }
  if (!deposit || !reference) {
    return json(
      { error: "We could not start that payment. Please try again." },
      500,
    );
  }

  const callbackBase = cfg.callbackUrl.replace(/\?.*$/, "");
  const callbackUrl = `${callbackBase}?reference=${encodeURIComponent(reference)}`;
  const res = await stkPush({ ...cfg, callbackUrl }, amountKes, msisdn, {
    description: copy.description,
    accountReference: reference,
  });
  const checkout = res.body.CheckoutRequestID;
  if (
    !(
      res.httpStatus >= 200 &&
      res.httpStatus < 300 &&
      String(res.body.ResponseCode ?? "") === "0" &&
      typeof checkout === "string" &&
      checkout.trim()
    )
  ) {
    await logEdgeError(
      admin,
      "deposits",
      "scanner-stk.stk_push",
      "STK push rejected",
      {
        code: String(res.body.ResponseCode ?? res.httpStatus),
        userId: user.id,
      },
    );
    await admin.rpc("fail_megapay_deposit", {
      p_deposit_id: deposit.id,
      p_status: "FAILED",
      p_kind: "initiation_failed",
      p_reason: "STK push rejected",
      p_raw: {
        http_status: res.httpStatus,
        ResponseCode: res.body.ResponseCode ?? null,
      },
    });
    return json(
      { error: "STK send failed, contact support for assistance" },
      502,
    );
  }

  const checkoutId = checkout.trim();
  const merchant =
    typeof res.body.MerchantRequestID === "string"
      ? res.body.MerchantRequestID
      : null;
  const { error: updateError } = await admin
    .from("deposits")
    .update({
      provider_reference: checkoutId,
      checkout_request_id: checkoutId,
      merchant_request_id: merchant,
    })
    .eq("id", deposit.id);
  if (updateError) {
    await logEdgeError(
      admin,
      "deposits",
      "scanner-stk.store_checkout",
      updateError,
      {
        code: updateError.code,
        userId: user.id,
      },
    );
  }

  console.log(
    "service charge daraja stk sent",
    kind,
    deposit.id,
    maskPhone(msisdn),
    amountKes,
  );
  return json({
    status: "PENDING",
    checkout_request_id: checkoutId,
    deposit_id: deposit.id,
    amount_kes: amountKes,
    provider: DARAJA_PROVIDER,
    message: "STK sent successfully",
  });
});
