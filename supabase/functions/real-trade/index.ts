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

const DEFAULT_FEES = {
  stakeMin: REAL_STAKE_MIN,
  stakeMax: REAL_STAKE_MAX,
  maxOpen: REAL_MAX_OPEN_TRADES,
  dailyLimit: null as number | null,
  payoutPercent: 95.22,
};

async function loadTradingFees(_admin: ReturnType<typeof adminClient>) {
  try {
    const rows = await runDirect(
      (sql) =>
        sql<{ key: string; value: string }[]>`select key, value from public.trading_settings`,
      1_200,
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
    // Skip PostgREST — it hangs when Auth/API is degraded and pauses trading.
    return { ...DEFAULT_FEES };
  }
}

async function handleTrade(req: Request): Promise<Response> {
  const admin = adminClient();
  const user = await userFromRequest(admin, req);
  if (!user) return json({ error: "Sign in to trade." }, 401);

  const [enabled, trading] = await Promise.all([
    realTradingEnabled(admin),
    loadTradingFees(admin),
  ]);
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
        1_200,
      );
      daily = rows[0]?.result ?? null;
    } catch (err) {
      console.error("trading.daily", err instanceof Error ? err.message : "error");
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

  // Validate against defaults first so we can fetch the entry tick BEFORE any
  // DB work. Hung pooler connections were wedging the isolate past WS timers.
  const parsed = validateRealTradeRequest(body, {
    stakeMin: REAL_STAKE_MIN,
    stakeMax: REAL_STAKE_MAX,
  });
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const input = parsed.value;

  let session: DerivSession | null = null;
  let entry = null;
  try {
    entry = await Promise.race([
      (async () => {
        session = await DerivSession.open();
        return await fetchFreshTick(session, input.symbol);
      })(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000)),
    ]);
  } catch (err) {
    console.error(
      "real-trade.entry_tick",
      err instanceof Error ? err.message : "error",
    );
  } finally {
    try {
      session?.close();
    } catch {
      /* closed */
    }
  }
  if (!entry) {
    // Optional client-provided tick from the live chart feed.
    const price = Number(body.entry_price);
    const epoch = Number(body.entry_epoch);
    const pip = Number(body.pip_size);
    const ageMs = Number.isFinite(epoch) ? Date.now() - epoch * 1000 : NaN;
    if (
      Number.isFinite(price) &&
      price > 0 &&
      Number.isFinite(epoch) &&
      Number.isFinite(pip) &&
      pip > 0 &&
      Number.isFinite(ageMs) &&
      ageMs >= -2_000 &&
      ageMs <= 5_000
    ) {
      entry = { price, epoch: Math.round(epoch), pipSize: pip, ageMs };
    }
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

  if (!enabled)
    return json({ error: PLACE_ERRORS.real_trading_disabled.message }, 403);
  if (input.stake < trading.stakeMin || input.stake > trading.stakeMax) {
    return json({ error: PLACE_ERRORS.invalid_stake.message }, 400);
  }
  const access = await loadUserAccess(admin, user.id);
  if (!access || access.accountStatus === "suspended") {
    return json({ error: "This account cannot trade right now." }, 403);
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
    const msg = err instanceof Error ? err.message : String(err);
    console.error("trading.place.direct", msg);
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
            5_000,
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
      console.error("trading.place", placeError?.message ?? NOT_CHARGED);
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
          select id, symbol, contract_type, contract_option, selected_digit, barrier,
                 stake, duration_ms, duration_ticks, entry_epoch, tick_anchor_epoch,
                 payout_rate, status, entry_price, exit_price, exit_digit, payout,
                 profit_loss, expires_at, resolved_at, created_at, updated_at
            from public.trades
           where id = ${placed!.trade_id}::uuid
           limit 1
        `,
      1_500,
    );
    trade = rows[0] ?? null;
  } catch (err) {
    console.error(
      "trading.place.read",
      err instanceof Error ? err.message : "error",
    );
  }
  if (!trade) {
    // Place already charged — never return trade:null or the UI treats it as failure.
    trade = {
      id: placed.trade_id,
      symbol: input.symbol,
      contract_type: input.contractType,
      contract_option: input.contractOption,
      selected_digit: input.selectedDigit,
      barrier: input.barrier,
      stake: input.stake,
      duration_ms: input.durationMs,
      duration_ticks: input.durationTicks ?? null,
      entry_epoch: entry.epoch,
      tick_anchor_epoch: entry.epoch,
      payout_rate: payoutRate,
      status: "open",
      entry_price: entry.price,
      exit_price: null,
      exit_digit: null,
      payout: null,
      profit_loss: null,
      expires_at: new Date(
        (entry.epoch + Math.max(2, input.durationTicks ?? 1) * 2) * 1000,
      ).toISOString(),
      resolved_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
  return json({
    trade,
    already: placed.already === true,
    entry_age_ms: Math.round(entry.ageMs),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  // Client allows ~35s for real-trade; keep a hard cap under that.
  const budgetMs = req.method === "GET" ? 6_000 : 28_000;
  try {
    return await Promise.race([
      handleTrade(req),
      new Promise<Response>((resolve) =>
        setTimeout(
          () =>
            resolve(
              json(
                {
                  error:
                    req.method === "GET"
                      ? "Trading status is temporarily unavailable. Please try again."
                      : "Live trading is temporarily unavailable. Your balance was not charged — please try again.",
                  enabled: req.method === "GET" ? true : undefined,
                },
                503,
              ),
            ),
          budgetMs,
        ),
      ),
    ]);
  } catch (err) {
    console.error(
      "real-trade.handler",
      err instanceof Error ? err.message : "error",
    );
    return json(
      {
        error:
          "Live trading is temporarily unavailable. Your balance was not charged — please try again.",
      },
      503,
    );
  }
});
