import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  DAILY_LIMIT_MESSAGE,
  HOUSE_MARGIN,
  REAL_MAX_OPEN_TRADES,
  REAL_STAKE_MAX,
  REAL_STAKE_MIN,
  REAL_TRADE_SYMBOLS,
  TICK_DURATION_DEFAULT,
  TICK_DURATION_MAX,
  TICK_DURATION_MIN,
  TRADE_DURATIONS,
  contractCanWin,
  validateRealTradeRequest,
} from "../_shared/digit-contracts.ts";
import {
  tradingFeesFromMap,
  type SettingsMap,
} from "../_shared/payment-settings.ts";
import { realAccountShort } from "../_shared/branding.ts";
import {
  DerivSession,
  TRADE_COLUMNS,
  adminClient,
  corsHeaders,
  fetchFreshTick,
  json,
  realTradingEnabled,
  userFromRequest,
} from "../_shared/trading-server.ts";
import { logEdgeError } from "../_shared/server.ts";
import { loadUserAccess } from "../_shared/user-access.ts";

function realPaused(): string {
  return `${realAccountShort()} trading is paused right now.`;
}

function realWalletNotReady(): string {
  return `Your ${realAccountShort()} wallet is not ready yet. Please contact support.`;
}

const NOT_CHARGED = "Could not place the trade. Your balance was not charged.";

function placeErrors(
  stakeMin: number,
  stakeMax: number,
  maxOpen: number,
): Record<string, { status: number; message: string }> {
  return {
    real_trading_disabled: { status: 403, message: realPaused() },
    daily_limit_reached: { status: 403, message: DAILY_LIMIT_MESSAGE },
    insufficient_funds: {
      status: 400,
      message: `Insufficient ${realAccountShort()} balance for this stake.`,
    },
    too_many_open_trades: {
      status: 429,
      message: `You already have ${maxOpen} open ${realAccountShort()} trades. Wait for one to settle.`,
    },
    stale_entry_tick: {
      status: 503,
      message:
        "The live price moved on before your trade could open. Please try again.",
    },
    invalid_stake: {
      status: 400,
      message: `Stake must be between $${stakeMin} and $${stakeMax}.`,
    },
    invalid_duration: {
      status: 400,
      message: "Select a valid duration (1–10 ticks).",
    },
    wallet_not_found: { status: 409, message: realWalletNotReady() },
    wallet_not_ready: { status: 409, message: realWalletNotReady() },
    invalid_payout_rate: {
      status: 400,
      message: "Trade payout settings are out of sync. Please refresh and try again.",
    },
    invalid_contract: {
      status: 400,
      message: "This contract cannot be placed right now.",
    },
    invalid_idempotency_key: { status: 400, message: NOT_CHARGED },
    invalid_entry_tick: {
      status: 503,
      message:
        "Live price is unavailable right now. Your balance was not charged — please try again.",
    },
  };
}

/** Match Postgres numeric payout rates — JS `95.22/100` is not exactly 0.9522. */
function payoutRateForRpc(payoutPercent: number, canWin: boolean): number {
  if (!canWin) return 0;
  return Math.round(payoutPercent * 100) / 10_000;
}

async function loadTradingFees(admin: ReturnType<typeof adminClient>) {
  const { data, error } = await admin
    .from("trading_settings")
    .select("key, value");
  if (error)
    await logEdgeError(admin, "trading", "trading_settings.load", error, {
      code: error.code,
    });
  const map: SettingsMap = {};
  for (const row of data ?? []) {
    const key = String((row as { key?: unknown }).key ?? "");
    if (!key) continue;
    map[key] = String((row as { value?: unknown }).value ?? "");
  }
  const fees = tradingFeesFromMap(map);
  const payoutRaw = Number(map.TRADE_PAYOUT_PERCENT);
  const payoutPercent =
    Number.isFinite(payoutRaw) && payoutRaw >= 0 && payoutRaw <= 500
      ? payoutRaw
      : 95.22;
  return {
    stakeMin: fees.stakeMinUsd || REAL_STAKE_MIN,
    stakeMax: fees.stakeMaxUsd || REAL_STAKE_MAX,
    maxOpen: fees.maxOpenTrades || REAL_MAX_OPEN_TRADES,
    dailyLimit: fees.dailyProfitLimitUsd,
    payoutPercent,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();
  const user = await userFromRequest(admin, req);
  if (!user) return json({ error: "Sign in to trade." }, 401);

  const enabled = await realTradingEnabled(admin);
  const trading = await loadTradingFees(admin);
  const PLACE_ERRORS = placeErrors(
    trading.stakeMin,
    trading.stakeMax,
    trading.maxOpen,
  );

  if (req.method === "GET") {
    const { data: daily, error: dailyError } = await admin.rpc(
      "real_trade_daily_status",
      { p_user_id: user.id },
    );
    if (dailyError) {
      await logEdgeError(
        admin,
        "trading",
        "real_trade_daily_status",
        dailyError,
        {
          code: dailyError.code,
          userId: user.id,
        },
      );
    }
    return json({
      enabled,
      house_margin: HOUSE_MARGIN,
      daily_limit_reached: daily?.reached === true,
      daily_limit_usd: daily?.limit ?? trading.dailyLimit,
      stake_min: trading.stakeMin,
      stake_max: trading.stakeMax,
      max_open_trades: trading.maxOpen,
      durations_ms: TRADE_DURATIONS.map((item) => item.ms),
      duration_ticks: {
        min: TICK_DURATION_MIN,
        max: TICK_DURATION_MAX,
        default: TICK_DURATION_DEFAULT,
      },
      symbols: REAL_TRADE_SYMBOLS,
      message: enabled ? null : realPaused(),
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return json({ error: "Invalid request." }, 400);

  const parsed = validateRealTradeRequest(body, {
    stakeMin: trading.stakeMin,
    stakeMax: trading.stakeMax,
  });
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  if (!enabled)
    return json({ error: PLACE_ERRORS.real_trading_disabled.message }, 403);
  const access = await loadUserAccess(admin, user.id);
  if (!access || access.accountStatus === "suspended") {
    return json({ error: "This account cannot trade right now." }, 403);
  }
  const input = parsed.value;

  const { data: existing } = await admin
    .from("trades")
    .select(TRADE_COLUMNS)
    .eq("user_id", user.id)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing) return json({ trade: existing, already: true });

  let session: DerivSession | null = null;
  let entry = null;
  try {
    session = await DerivSession.open();
    entry = await fetchFreshTick(session, input.symbol);
  } catch (err) {
    await logEdgeError(admin, "trading", "real-trade.entry_tick", err, {
      userId: user.id,
    });
  } finally {
    session?.close();
  }
  if (!entry) {
    return json(
      {
        error:
          "Live price is unavailable right now. Your balance was not charged — please try again.",
      },
      503,
    );
  }

  const common = {
    p_user_id: user.id,
    p_symbol: input.symbol,
    p_contract_type: input.contractType,
    p_contract_option: input.contractOption,
    p_selected_digit: input.selectedDigit,
    p_barrier: input.barrier,
    p_stake: input.stake,
    p_payout_rate: payoutRateForRpc(
      trading.payoutPercent,
      contractCanWin(input),
    ),
    p_entry_price: entry.price,
    p_entry_epoch: entry.epoch,
    p_pip_size: entry.pipSize,
    p_idempotency_key: input.idempotencyKey,
  };
  const rpcName =
    input.durationTicks != null ? "place_real_tick_trade" : "place_real_trade";
  const { data: placed, error } =
    input.durationTicks != null
      ? await admin.rpc(rpcName, {
          ...common,
          p_duration_ticks: input.durationTicks,
        })
      : await admin.rpc(rpcName, {
          ...common,
          p_duration_ms: input.durationMs,
        });
  if (error || !placed?.trade_id) {
    const known = error ? PLACE_ERRORS[error.message] : undefined;
    if (!known) {
      await logEdgeError(admin, "trading", rpcName, error ?? NOT_CHARGED, {
        code: error?.code,
        userId: user.id,
      });
    }
    return json({ error: known?.message ?? NOT_CHARGED }, known?.status ?? 500);
  }

  const { data: trade } = await admin
    .from("trades")
    .select(TRADE_COLUMNS)
    .eq("id", placed.trade_id)
    .single();
  return json({
    trade,
    already: placed.already === true,
    entry_age_ms: Math.round(entry.ageMs),
  });
});
