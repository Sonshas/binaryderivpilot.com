import {
  DEMO_ACCOUNT_ID,
  DEMO_USER_ID,
  DEMO_WALLET_ID,
  REAL_ACCOUNT_ID,
  REAL_USER_ID,
  REAL_WALLET_ID,
} from "@/domain/account";
import {
  estimatedTickExpiryMs,
  extractLastDigit,
  isValidTickDuration,
  lastDigitOfPrice,
  payoutFor,
  REAL_ENTRY_MAX_AGE_MS,
  REAL_MAX_OPEN_TRADES,
  REAL_STAKE_MAX,
  REAL_STAKE_MIN,
  REAL_TRADE_SYMBOLS,
  selectNthTickAfter,
  settleDigitContract,
  validateContractSelection,
  validateRealStake,
} from "@/domain/digit-contracts";
import { quotedProfitRate, readTradeSettings } from "@/lib/trade-settings";
import {
  applyDemoBalance,
  listStoredDemoStates,
  peekDemoAvailable,
  updateStoredDemoState,
} from "@/lib/demo-store";
import { createId, nowIso } from "@/lib/ids";
import { loadRealBook, updateRealBook } from "@/lib/real-books";
import {
  getBufferedTicks,
  getLastReceivedAt,
  getLatestBufferedTick,
} from "@/providers/market-data/tick-buffer";
import type { AccountMode, ContractOption, ContractType, Trade } from "@/types";
import { realAccountShort } from "@/lib/branding";

const ENTRY_MAX_AGE_MS = 30_000;

export interface PlaceUserTradeInput {
  symbol: string;
  contractOption: "even" | "odd";
  stake: number;
  durationTicks: number;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function demoTrades(email: string): Trade[] {
  const key = email.trim().toLowerCase();
  const row = listStoredDemoStates().find(
    (item) => item.email.trim().toLowerCase() === key,
  );
  return row?.state.trades ?? [];
}

export function countUserTrades(email: string, mode: AccountMode): number {
  if (mode === "real") return loadRealBook(email).trades.length;
  return demoTrades(email).length;
}

export function clearUserTrades(email: string, mode: AccountMode): number {
  if (mode === "real") {
    const book = loadRealBook(email);
    const removed = book.trades.length;
    const refund = book.trades
      .filter((trade) => trade.status === "open")
      .reduce((sum, trade) => sum + trade.stake, 0);
    updateRealBook(email, (current) => ({
      ...current,
      trades: [],
      available: roundMoney(current.available + refund),
      locked: roundMoney(Math.max(0, current.locked - refund)),
    }));
    return removed;
  }
  let removed = 0;
  updateStoredDemoState(email, (state) => {
    removed = state.trades.length;
    const refund = state.trades
      .filter((trade) => trade.status === "open")
      .reduce((sum, trade) => sum + trade.stake, 0);
    const ids = new Set(state.trades.map((trade) => trade.id));
    const next = applyDemoBalance(state, refund, -refund, Date.now());
    return {
      ...next,
      trades: [],
      settlements: next.settlements.filter((row) => !ids.has(row.tradeId)),
    };
  });
  return removed;
}

function buildTrade(
  mode: AccountMode,
  input: PlaceUserTradeInput,
  entryPrice: number,
  anchorMs: number,
  now: number,
): Trade {
  const createdAt = nowIso(now);
  const durationMs =
    estimatedTickExpiryMs(anchorMs, input.durationTicks, input.symbol) -
    anchorMs;
  const demo = mode === "demo";
  return {
    id: createId("trd"),
    userId: demo ? DEMO_USER_ID : REAL_USER_ID,
    accountId: demo ? DEMO_ACCOUNT_ID : REAL_ACCOUNT_ID,
    accountMode: mode,
    walletId: demo ? DEMO_WALLET_ID : REAL_WALLET_ID,
    walletKind: mode,
    symbol: input.symbol,
    market: input.symbol,
    contractType: "EVEN_ODD",
    contractOption: input.contractOption,
    selectedDigit: null,
    barrier: null,
    stake: input.stake,
    durationMs,
    duration: durationMs,
    durationTicks: input.durationTicks,
    entryEpochMs: anchorMs,
    tickAnchorMs: anchorMs,
    payoutRate: quotedProfitRate({
      contractType: "EVEN_ODD",
      contractOption: input.contractOption,
      selectedDigit: null,
      barrier: null,
    }),
    status: "open",
    result: "open",
    entryPrice,
    exitPrice: null,
    exitDigit: null,
    payout: null,
    profitLoss: null,
    expiresAt: nowIso(anchorMs + durationMs),
    resolvedAt: null,
    isSimulated: demo,
    createdAt,
    updatedAt: createdAt,
  };
}

export function placeUserTrade(
  email: string,
  mode: AccountMode,
  input: PlaceUserTradeInput,
): { ok: true; trade: Trade } | { ok: false; error: string } {
  const symbol = input.symbol.trim();
  if (!(REAL_TRADE_SYMBOLS as readonly string[]).includes(symbol)) {
    return { ok: false, error: "Choose a volatility market." };
  }
  const stake = roundMoney(input.stake);
  if (!Number.isFinite(stake) || stake <= 0)
    return { ok: false, error: "Enter a stake above zero." };
  if (!isValidTickDuration(input.durationTicks))
    return { ok: false, error: "Duration must be 1 to 10 ticks." };
  if (input.contractOption !== "even" && input.contractOption !== "odd") {
    return { ok: false, error: "Choose Even or Odd." };
  }
  const now = Date.now();
  const entryTick = getLatestBufferedTick(symbol);
  if (!entryTick || now - getLastReceivedAt(symbol) > ENTRY_MAX_AGE_MS) {
    return { ok: false, error: `Waiting for a live price on ${symbol}.` };
  }
  const available =
    mode === "demo" ? peekDemoAvailable(email) : loadRealBook(email).available;
  if (available + 1e-9 < stake) {
    return {
      ok: false,
      error: `That stake is higher than the ${mode === "demo" ? "demo" : "real"} balance.`,
    };
  }
  const trade = buildTrade(
    mode,
    { ...input, symbol, stake },
    entryTick.price,
    entryTick.timestamp,
    now,
  );
  if (mode === "demo") {
    updateStoredDemoState(email, (state) => {
      const next = applyDemoBalance(state, -stake, stake, now);
      return { ...next, trades: [trade, ...next.trades] };
    });
    return { ok: true, trade };
  }
  updateRealBook(email, (book) => ({
    ...book,
    available: roundMoney(book.available - stake),
    locked: roundMoney(book.locked + stake),
    trades: [trade, ...book.trades],
  }));
  return { ok: true, trade };
}

export interface OpenLocalRealTradeInput {
  symbol: string;
  contractType: ContractType;
  contractOption: ContractOption;
  selectedDigit: number | null;
  barrier: number | null;
  stake: number;
  durationTicks: number;
}

export function openLocalRealTrade(
  email: string,
  input: OpenLocalRealTradeInput,
): { ok: true; trade: Trade } | { ok: false; error: string } {
  const symbol = input.symbol.trim();
  if (!(REAL_TRADE_SYMBOLS as readonly string[]).includes(symbol)) {
    return {
      ok: false,
      error: `This market is not available for ${realAccountShort()} trading.`,
    };
  }
  const invalid =
    validateContractSelection(input) ??
    validateRealStake(input.stake, null, {
      min: REAL_STAKE_MIN,
      max: REAL_STAKE_MAX,
    });
  if (invalid) return { ok: false, error: invalid };
  if (!isValidTickDuration(input.durationTicks))
    return { ok: false, error: "Duration must be 1 to 10 ticks." };
  const now = Date.now();
  const entryTick = getLatestBufferedTick(symbol);
  if (!entryTick || now - getLastReceivedAt(symbol) > REAL_ENTRY_MAX_AGE_MS) {
    return { ok: false, error: `Waiting for a live price on ${symbol}.` };
  }
  const book = loadRealBook(email);
  const openCount = book.trades.filter(
    (trade) => trade.status === "open",
  ).length;
  if (openCount >= REAL_MAX_OPEN_TRADES) {
    return {
      ok: false,
      error: `Too many open ${realAccountShort()} trades. Wait for one to settle.`,
    };
  }
  const stake = roundMoney(input.stake);
  if (book.available + 1e-9 < stake)
    return {
      ok: false,
      error: `Insufficient ${realAccountShort()} balance for this stake.`,
    };
  const createdAt = nowIso(now);
  const anchorMs = entryTick.timestamp;
  const durationMs =
    estimatedTickExpiryMs(anchorMs, input.durationTicks, symbol) - anchorMs;
  const trade: Trade = {
    id: createId("trd"),
    userId: REAL_USER_ID,
    accountId: REAL_ACCOUNT_ID,
    accountMode: "real",
    walletId: REAL_WALLET_ID,
    walletKind: "real",
    symbol,
    market: symbol,
    contractType: input.contractType,
    contractOption: input.contractOption,
    selectedDigit:
      input.contractType === "MATCH_DIFFER" ? input.selectedDigit : null,
    barrier: input.contractType === "OVER_UNDER" ? input.barrier : null,
    stake,
    durationMs,
    duration: durationMs,
    durationTicks: input.durationTicks,
    entryEpochMs: anchorMs,
    tickAnchorMs: anchorMs,
    payoutRate: quotedProfitRate({
      contractType: input.contractType,
      contractOption: input.contractOption,
      selectedDigit: input.selectedDigit,
      barrier: input.barrier,
    }),
    status: "open",
    result: "open",
    entryPrice: entryTick.price,
    exitPrice: null,
    exitDigit: null,
    payout: null,
    profitLoss: null,
    expiresAt: nowIso(anchorMs + durationMs),
    resolvedAt: null,
    isSimulated: false,
    createdAt,
    updatedAt: createdAt,
  };
  updateRealBook(email, (current) => ({
    ...current,
    available: roundMoney(current.available - stake),
    locked: roundMoney(current.locked + stake),
    trades: [trade, ...current.trades],
  }));
  return { ok: true, trade };
}

export function settleLocalRealTrades(email: string, now = Date.now()): void {
  const key = email.trim().toLowerCase();
  if (!key) return;
  const book = loadRealBook(key);
  if (
    !book.trades.some(
      (trade) =>
        trade.status === "open" &&
        trade.durationTicks != null &&
        trade.tickAnchorMs != null,
    )
  )
    return;
  let available = book.available;
  let locked = book.locked;
  let changed = false;
  const trades = book.trades.map((trade) => {
    if (
      trade.status !== "open" ||
      trade.durationTicks == null ||
      trade.tickAnchorMs == null
    )
      return trade;
    const ticks = getBufferedTicks(trade.symbol).map((tick) => ({
      ...tick,
      epochMs: tick.timestamp,
    }));
    const found = selectNthTickAfter(
      ticks,
      trade.tickAnchorMs,
      trade.durationTicks,
    );
    if (!found) return trade;
    const exit = found.exit as {
      price: number;
      lastDigit?: number | null;
      pipSize?: number | null;
    };
    const exitDigit =
      typeof exit.lastDigit === "number" && Number.isInteger(exit.lastDigit)
        ? exit.lastDigit
        : exit.pipSize != null
          ? (extractLastDigit(exit.price, exit.pipSize) ??
            lastDigitOfPrice(exit.price))
          : lastDigitOfPrice(exit.price);
    const outcome = settleDigitContract({
      contractType: trade.contractType,
      contractOption: trade.contractOption,
      selectedDigit: trade.selectedDigit,
      barrier: trade.barrier,
      exitPrice: found.exit.price,
      exitDigit,
      winRatePercent: readTradeSettings().realWinRatePercent,
    });
    const payout = payoutFor(trade.stake, trade.payoutRate ?? 0, outcome);
    available = roundMoney(available + payout);
    locked = roundMoney(Math.max(0, locked - trade.stake));
    changed = true;
    const updatedAt = nowIso(now);
    return {
      ...trade,
      status: outcome,
      result: outcome,
      exitPrice: found.exit.price,
      exitDigit,
      payout,
      profitLoss: roundMoney(payout - trade.stake),
      resolvedAt: updatedAt,
      updatedAt,
    };
  });
  if (!changed) return;
  updateRealBook(key, () => ({ ...book, available, locked, trades }));
}
