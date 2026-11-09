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
import { runDirect } from "../_shared/direct-db.ts";
import { callPlaceRealTrade } from "../_shared/direct-money.ts";
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
  try {
    const rows = await runDirect(
      (sql) => sql<{ key: string; value: string }[]>`select key, value from public.trading_settings`,
      3_000,
    );
    const map: SettingsMap = {};
    for (const row of rows) {
      const key = String(row.key ?? "");
      if (key) map[key] = String(row.value ?? "");
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
  } catch (err) {
    console.error("trading.settings", err instanceof Error ? err.message : "error");
  }
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
    let daily: { reached?: boolean; limit?: number | null } | null = null;
    try {
      const rows = await runDirect(
        (sql) =>
          sql<{ result: { reached?: boolean; limit?: number | null } }[]>`
            select public.real_trade_daily_status(${user.id}::uuid) as result
          `,
        4_000,
      );
      daily = rows[0]?.result ?? null;
    } catch (err) {
      console.error("trading.daily", err instanceof Error ? err.message : "error");
    }
    const { data: dailyRest, error: dailyError } = daily
      ? { data: daily, error: null }
      : await Promise.race([
          admin.rpc("real_trade_daily_status", { p_user_id: user.id }),
          new Promise<{ data: null; error: { message: string; code: string } }>((resolve) =>
            setTimeout(
              () => resolve({ data: null, error: { message: "timeout", code: "57014" } }),
              3_000,
            ),
          ),
        ]);
    if (!daily && dailyRest) daily = dailyRest as { reached?: boolean; limit?: number | null };
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

  const existingRest = await Promise.race([
    admin
      .from("trades")
      .select(TRADE_COLUMNS)
      .eq("user_id", user.id)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle(),
    new Promise<{ data: null }>((resolve) =>
      setTimeout(() => resolve({ data: null }), 2_500),
    ),
  ]);
  if (existingRest.data) return json({ trade: existingRest.data, already: true });

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

  const payoutRate = payoutRateForRpc(
    trading.payoutPercent,
    contractCanWin(input),
  );
  const rpcName =
    input.durationTicks != null ? "place_real_tick_trade" : "place_real_trade";
  let placed: { trade_id?: string; already?: boolean } | null = null;
  let placeError: { message?: string; code?: string } | null = null;
  try {
    placed = await callPlaceRealTrade({
      userId: user.id,
      symbol: input.symbol,
      contractType: input.contractType,
      contractOption: input.contractOption,
      selectedDigit: input.selectedDigit,
      barrier: input.barrier,
      stake: input.stake,
      payoutRate,
      entryPrice: entry.price,
      entryEpoch: entry.epoch,
      pipSize: entry.pipSize,
      idempotencyKey: input.idempotencyKey,
      durationTicks: input.durationTicks,
      durationMs: input.durationMs,
    });
  } catch (err) {
    console.error(
      "trading.place.direct",
      err instanceof Error ? err.message : "error",
    );
    const msg = err instanceof Error ? err.message : "";
    if (/real_trading_disabled|daily_limit_reached|insufficient_funds|too_many_open_trades|stale_entry_tick|invalid_stake|invalid_duration|wallet_not_found|wallet_not_ready|invalid_payout_rate|invalid_contract|invalid_idempotency_key|invalid_entry_tick/i.test(msg)) {
      placeError = { message: msg.split(" ").pop() ?? msg };
    }
  }
  if (!placed?.trade_id && !placeError) {
    const common = {
      p_user_id: user.id,
      p_symbol: input.symbol,
      p_contract_type: input.contractType,
      p_contract_option: input.contractOption,
      p_selected_digit: input.selectedDigit,
      p_barrier: input.barrier,
      p_stake: input.stake,
      p_payout_rate: payoutRate,
      p_entry_price: entry.price,
      p_entry_epoch: entry.epoch,
      p_pip_size: entry.pipSize,
      p_idempotency_key: input.idempotencyKey,
    };
    const rpcCall =
      input.durationTicks != null
        ? admin.rpc(rpcName, {
            ...common,
            p_duration_ticks: input.durationTicks,
          })
        : admin.rpc(rpcName, {
            ...common,
            p_duration_ms: input.durationMs,
          });
    const raced = await Promise.race([
      rpcCall,
      new Promise<{ data: null; error: { message: string; code: string } }>(
        (resolve) =>
          setTimeout(
            () =>
              resolve({
                data: null,
                error: { message: "timeout", code: "57014" },
              }),
            8_000,
          ),
      ),
    ]);
    placed =
      (raced.data as { trade_id?: string; already?: boolean } | null) ?? null;
    placeError = raced.error;
  }
  if (placeError || !placed?.trade_id) {
    const known = placeError
      ? PLACE_ERRORS[placeError.message ?? ""]
      : undefined;
    if (!known) {
      await logEdgeError(admin, "trading", rpcName, placeError ?? NOT_CHARGED, {
        code: placeError?.code,
        userId: user.id,
      });
    }
    return json(
      { error: known?.message ?? NOT_CHARGED },
      known?.status ?? 500,
    );
  }

  let trade: Record<string, unknown> | null = null;
  try {
    const rows = await runDirect(
      (sql) =>
        sql<Record<string, unknown>[]>`
          select *
            from public.trades
           where id = ${placed!.trade_id}::uuid
           limit 1
        `,
      3_000,
    );
    trade = rows[0] ?? null;
  } catch (err) {
    console.error(
      "trading.place.read",
      err instanceof Error ? err.message : "error",
    );
  }
  if (!trade) {
    const { data } = await Promise.race([
      admin
        .from("trades")
        .select(TRADE_COLUMNS)
        .eq("id", placed.trade_id)
        .single(),
      new Promise<{ data: null }>((resolve) =>
        setTimeout(() => resolve({ data: null }), 2_500),
      ),
    ]);
    trade = data;
  }
  return json({
    trade,
    already: placed.already === true,
    entry_age_ms: Math.round(entry.ageMs),
  });
});
