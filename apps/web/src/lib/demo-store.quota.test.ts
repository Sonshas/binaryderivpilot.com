import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialDemoState,
  loadDemoState,
  persistDemoState,
  resetDemoState,
} from "@/lib/demo-store";
import {
  clearDemoCredentials,
  clearDemoSession,
  resetDemoSessionMemory,
  saveDemoSession,
} from "@/lib/demo-session";
import { DEMO_STORAGE_KEY } from "@/providers/config";
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
    userId: "demo-user",
    accountId: "demo-account",
    accountMode: "demo",
    walletId: "demo-wallet",
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
    isSimulated: true,
    walletKind: "demo",
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  store.clear();
  installLocalStorage();
  resetDemoSessionMemory();
  clearDemoSession();
  clearDemoCredentials();
  resetDemoState();
});

describe("demo-store localStorage quota", () => {
  it("caps closed trade history before persist", () => {
    saveDemoSession({ email: "demo@example.com", name: "Demo" });
    const state = createInitialDemoState();
    state.trades = Array.from({ length: 250 }, (_, i) => closedTrade(i));
    persistDemoState(state);
    const raw = store.get(`${DEMO_STORAGE_KEY}:demo@example.com`);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { trades: Trade[] };
    expect(parsed.trades).toHaveLength(200);
  });

  it("recovers from QuotaExceededError without throwing", () => {
    saveDemoSession({ email: "demo@example.com", name: "Demo" });
    installLocalStorage({ failUntil: 1 });
    // Keep session keys so loadDemoState still resolves the email-scoped store.
    for (const [key, value] of [...store.entries()]) {
      if (!key.startsWith(DEMO_STORAGE_KEY)) store.set(key, value);
    }
    expect(() => {
      const state = createInitialDemoState();
      state.trades = Array.from({ length: 80 }, (_, i) => closedTrade(i));
      persistDemoState(state);
    }).not.toThrow();
    expect(loadDemoState().trades.length).toBeLessThanOrEqual(40);
  });
});
