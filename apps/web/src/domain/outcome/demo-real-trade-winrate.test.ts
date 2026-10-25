import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const memoryStore = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memoryStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStore.set(key, String(value));
  },
  removeItem: (key: string) => {
    memoryStore.delete(key);
  },
  clear: () => memoryStore.clear(),
  key: (index: number) => [...memoryStore.keys()][index] ?? null,
  get length() {
    return memoryStore.size;
  },
});
import {
  DIGIT_CONTRACT_KINDS,
  selectionForKind,
  type DigitContractKind,
} from "@/domain/digit-contracts";
import { settleDigitContract } from "@/domain/outcome";
import {
  clearUserTrades,
  openLocalRealTrade,
  settleLocalRealTrades,
} from "@/lib/admin-user-trades";
import {
  DEFAULT_WIN_RATE_PERCENT,
  readTradeSettings,
  saveTradeSettings,
} from "@/lib/trade-settings";
import { resetDemoState } from "@/lib/demo-store";
import {
  clearDemoCredentials,
  clearDemoSession,
  resetDemoSessionMemory,
  saveDemoSession,
} from "@/lib/demo-session";
import { loadRealBook, updateRealBook } from "@/lib/real-books";
import {
  clearTickBufferForTests,
  recordTicks,
} from "@/providers/market-data/tick-buffer";
import {
  demoTradingProvider,
  settleDemoTrades,
} from "@/providers/trading/demo-trading-provider";
import type { ContractOption, Tick, Trade } from "@/types";

const EMAIL = "george@smartbasebinary.com";
const SYMBOL = "R_10";
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const STAKE = 1;

type Row = {
  account: "demo" | "real";
  kind: DigitContractKind;
  target: number | null;
  exitDigit: number;
  outcome: "won" | "lost";
  expected: "won" | "lost";
};

function priceForDigit(digit: number): number {
  return Number((1000 + digit * 0.01).toFixed(2));
}

function liveTick(price: number, timestamp: number): Tick {
  const pipSize = 0.01;
  return {
    symbol: SYMBOL,
    price,
    timestamp,
    pipSize,
    lastDigit: Math.round(price / pipSize) % 10,
    isSimulated: false,
    feedLabel: "test feed",
  };
}

function expectedOutcome(
  kind: DigitContractKind,
  target: number | null,
  exitDigit: number,
): "won" | "lost" {
  const selection = selectionForKind(kind, target);
  return settleDigitContract({
    ...selection,
    exitPrice: priceForDigit(exitDigit),
    exitDigit,
    winRatePercent: readTradeSettings().demoWinRatePercent,
  });
}

function casesForKind(
  kind: DigitContractKind,
): Array<{ target: number | null; exitDigit: number }> {
  if (kind === "EVEN" || kind === "ODD") {
    return DIGITS.map((exitDigit) => ({ target: null, exitDigit }));
  }
  const rows: Array<{ target: number | null; exitDigit: number }> = [];
  for (const target of DIGITS) {
    if (kind === "OVER" && target === 9) continue;
    if (kind === "UNDER" && target === 0) continue;
    for (const exitDigit of DIGITS) rows.push({ target, exitDigit });
  }
  return rows;
}

async function placeAndSettleDemo(
  kind: DigitContractKind,
  target: number | null,
  exitDigit: number,
  clock: number,
): Promise<Trade> {
  const selection = selectionForKind(kind, target);
  clearTickBufferForTests();
  recordTicks(SYMBOL, [liveTick(priceForDigit(0), clock)]);
  const placed = await demoTradingProvider.placeTrade({
    kind: "demo",
    accountMode: "demo",
    symbol: SYMBOL,
    contractType: selection.contractType,
    contractOption: selection.contractOption,
    selectedDigit: selection.selectedDigit,
    barrier: selection.barrier,
    stake: STAKE,
    durationTicks: 1,
    durationMs: 1000,
  });
  if (placed.status !== "ready" || !placed.data) {
    throw new Error(`DEMO place failed (${placed.status}): ${placed.message}`);
  }
  const trade = placed.data;

  recordTicks(SYMBOL, [
    liveTick(priceForDigit(exitDigit), (trade.tickAnchorMs ?? clock) + 1000),
  ]);
  settleDemoTrades(clock + 5_000);
  const settled = settleDemoTrades(clock + 6_000);
  const closed =
    settled.find((row) => row.id === trade.id) ??
    (await demoTradingProvider.getTradeStatus(trade.id, "demo")).data;
  expect(closed).toBeTruthy();
  expect(closed!.status === "won" || closed!.status === "lost").toBe(true);
  return closed!;
}

function placeAndSettleReal(
  kind: DigitContractKind,
  target: number | null,
  exitDigit: number,
  clock: number,
): Trade {
  const selection = selectionForKind(kind, target);
  clearTickBufferForTests();
  recordTicks(SYMBOL, [liveTick(priceForDigit(0), clock)]);
  const placed = openLocalRealTrade(EMAIL, {
    symbol: SYMBOL,
    contractType: selection.contractType,
    contractOption: selection.contractOption as ContractOption,
    selectedDigit: selection.selectedDigit,
    barrier: selection.barrier,
    stake: STAKE,
    durationTicks: 1,
  });
  if (!placed.ok) throw new Error(`REAL place failed: ${placed.error}`);
  const trade = placed.trade;
  recordTicks(SYMBOL, [
    liveTick(priceForDigit(exitDigit), (trade.tickAnchorMs ?? clock) + 1000),
  ]);
  settleLocalRealTrades(EMAIL, clock + 5_000);
  const bookTrade = loadRealBook(EMAIL).trades.find(
    (row) => row.id === trade.id,
  );
  expect(bookTrade).toBeTruthy();
  expect(bookTrade!.status === "won" || bookTrade!.status === "lost").toBe(
    true,
  );
  return bookTrade!;
}

function summarize(rows: Row[]) {
  const byAccount = (account: "demo" | "real") => {
    const subset = rows.filter((row) => row.account === account);
    const won = subset.filter((row) => row.outcome === "won").length;
    const lost = subset.filter((row) => row.outcome === "lost").length;
    const byKind = DIGIT_CONTRACT_KINDS.map((kind) => {
      const group = subset.filter((row) => row.kind === kind);
      const w = group.filter((row) => row.outcome === "won").length;
      const l = group.filter((row) => row.outcome === "lost").length;
      return {
        kind,
        trades: group.length,
        won: w,
        lost: l,
        winRatePct: group.length
          ? Math.round((w / group.length) * 1000) / 10
          : 0,
      };
    });
    return {
      account,
      trades: subset.length,
      won,
      lost,
      winRatePct: subset.length
        ? Math.round((won / subset.length) * 1000) / 10
        : 0,
      byKind,
    };
  };
  return {
    generatedAt: new Date().toISOString(),
    stakePerTrade: STAKE,
    symbol: SYMBOL,
    settleEngine: "outcome/settle via digit-contracts",
    totalTrades: rows.length,
    mismatches: rows.filter((row) => row.outcome !== row.expected).length,
    demo: byAccount("demo"),
    real: byAccount("real"),
    overallWinRatePct:
      rows.length === 0
        ? 0
        : Math.round(
            (rows.filter((row) => row.outcome === "won").length / rows.length) *
              1000,
          ) / 10,
  };
}

beforeEach(() => {
  memoryStore.clear();
  resetDemoState();
  clearDemoSession();
  clearDemoCredentials();
  resetDemoSessionMemory();
  clearTickBufferForTests();
  saveDemoSession({
    email: EMAIL,
    name: "Winrate Test",
    phone: "254700000000",
    country: "KE",
    password: "test-password",
  });
  clearUserTrades(EMAIL, "real");
  updateRealBook(EMAIL, (book) => ({
    ...book,
    available: 50_000,
    locked: 0,
    trades: [],
  }));
  saveTradeSettings({
    demoWinRatePercent: 90,
    realWinRatePercent: 90,
    vipWinRatePercent: 90,
    scannerWinRatePercent: 90,
  });
});

describe("comprehensive DEMO + Real trade win-rate matrix", () => {
  it("uses admin trade-settings win rates at 90%", () => {
    expect(DEFAULT_WIN_RATE_PERCENT).toBe(90);
    const settings = readTradeSettings();
    expect(settings.demoWinRatePercent).toBe(90);
    expect(settings.realWinRatePercent).toBe(90);
    expect(settings.vipWinRatePercent).toBe(90);
    expect(settings.scannerWinRatePercent).toBe(90);
  });

  it("places and settles every contract kind × target × exit digit on DEMO and Real at 90%", async () => {
    expect(readTradeSettings().demoWinRatePercent).toBe(90);
    expect(readTradeSettings().realWinRatePercent).toBe(90);
    const rows: Row[] = [];

    for (const kind of DIGIT_CONTRACT_KINDS) {
      for (const { target, exitDigit } of casesForKind(kind)) {
        const expected = expectedOutcome(kind, target, exitDigit);
        const clock = Date.now();

        const demoClosed = await placeAndSettleDemo(
          kind,
          target,
          exitDigit,
          clock,
        );
        rows.push({
          account: "demo",
          kind,
          target,
          exitDigit,
          outcome: demoClosed.status as "won" | "lost",
          expected,
        });

        const realClosed = placeAndSettleReal(
          kind,
          target,
          exitDigit,
          Date.now(),
        );
        rows.push({
          account: "real",
          kind,
          target,
          exitDigit,
          outcome: realClosed.status as "won" | "lost",
          expected,
        });
      }
    }

    const report = {
      ...summarize(rows),
      adminWinRates: readTradeSettings(),
    };
    const outPath = resolve(
      process.cwd(),
      "scripts/demo-real-winrate-report.json",
    );
    writeFileSync(outPath, JSON.stringify({ report, rows }, null, 2));

    expect(report.adminWinRates.demoWinRatePercent).toBe(90);
    expect(report.adminWinRates.realWinRatePercent).toBe(90);

    expect(report.mismatches).toBe(0);
    expect(report.demo.trades).toBe(400);
    expect(report.real.trades).toBe(400);
    expect(report.totalTrades).toBe(800);
    expect(report.demo.winRatePct).toBe(90);
    expect(report.real.winRatePct).toBe(90);
    for (const side of [report.demo, report.real]) {
      expect(side.byKind.find((k) => k.kind === "EVEN")?.winRatePct).toBe(90);
      expect(side.byKind.find((k) => k.kind === "ODD")?.winRatePct).toBe(90);
      expect(side.byKind.find((k) => k.kind === "MATCH")?.winRatePct).toBe(90);
      expect(side.byKind.find((k) => k.kind === "DIFFER")?.winRatePct).toBe(90);
      expect(side.byKind.find((k) => k.kind === "OVER")?.winRatePct).toBe(90);
      expect(side.byKind.find((k) => k.kind === "UNDER")?.winRatePct).toBe(90);
    }
  }, 180_000);
});
