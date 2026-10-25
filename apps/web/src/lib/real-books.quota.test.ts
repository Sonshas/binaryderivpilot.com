import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadRealBook,
  updateRealBook,
} from "@/lib/real-books";
import type { Trade } from "@/types";

const store = new Map<string, string>();

function installLocalStorage(opts?: { failUntil?: number }) {
  let failsLeft = opts?.failUntil ?? 0;
  vi.stubGlobal("localStorage", {
    get length() {
      return store.size;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (failsLeft > 0) {
        failsLeft -= 1;
        throw new DOMException(
          "Setting the value exceeded the quota.",
          "QuotaExceededError",
        );
      }
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  });
}

function closedTrade(i: number): Trade {
  const now = new Date(Date.now() - i * 1000).toISOString();
  return {
    id: `trd_${i}`,
    userId: "real-user",
    accountId: "real-account",
    accountMode: "real",
    walletId: "real-wallet",
    symbol: "R_100",
    market: "R_100",
    contractType: "EVEN_ODD",
    contractOption: "even",
    selectedDigit: null,
    barrier: null,
    stake: 1,
    payout: 1.9,
    payoutRate: 0.9,
    profitLoss: 0.9,
    duration: 1000,
    durationMs: 1000,
    entryPrice: 100,
    exitPrice: 101,
    status: "won",
    result: "won",
    expiresAt: now,
    resolvedAt: now,
    isSimulated: false,
    walletKind: "real",
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  store.clear();
  installLocalStorage();
});

describe("real-books localStorage quota", () => {
  it("caps closed trade history before persist", () => {
    updateRealBook("real@example.com", (book) => ({
      ...book,
      trades: Array.from({ length: 250 }, (_, i) => closedTrade(i)),
    }));
    expect(loadRealBook("real@example.com").trades).toHaveLength(200);
  });

  it("recovers from QuotaExceededError without throwing", () => {
    installLocalStorage({ failUntil: 1 });
    expect(() => {
      updateRealBook("real@example.com", (book) => ({
        ...book,
        available: 25,
        trades: Array.from({ length: 80 }, (_, i) => closedTrade(i)),
      }));
    }).not.toThrow();
    const book = loadRealBook("real@example.com");
    expect(book.available).toBe(25);
    expect(book.trades.length).toBeLessThanOrEqual(40);
  });
});
