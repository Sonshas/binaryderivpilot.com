import {
  DEMO_ACCOUNT_ID,
  DEMO_USER_ID,
  DEMO_WALLET_ID,
} from "@/domain/account";
import { assertSameMode } from "@/domain/isolation";
import { createId, nowIso } from "@/lib/ids";
import { loadDemoSession, subscribeDemoSession } from "@/lib/demo-session";
import { DEMO_STARTING_BALANCE, DEMO_STORAGE_KEY } from "@/providers/config";
import { demoAccountShort } from "@/lib/branding";
import type {
  Account,
  BotRun,
  Deposit,
  Notification,
  NotificationKind,
  SupportTicket,
  Trade,
  TradeSettlement,
  Transaction,
  Wallet,
  WalletLedger,
  Withdrawal,
} from "@/types";

export interface DemoState {
  account: Account;
  wallet: Wallet;
  ledger: WalletLedger[];
  transactions: Transaction[];
  deposits: Deposit[];
  withdrawals: Withdrawal[];
  trades: Trade[];
  settlements: TradeSettlement[];
  botRuns: BotRun[];
  notifications: Notification[];
  tickets: SupportTicket[];
}

const listeners = new Set<() => void>();

/** Keep demo localStorage under browser quota (~5MB). Newest-first arrays. */
type DemoHistoryCaps = {
  trades: number;
  settlements: number;
  ledger: number;
  transactions: number;
  notifications: number;
  botRuns: number;
  deposits: number;
  withdrawals: number;
  tickets: number;
};

const DEMO_HISTORY_CAPS: DemoHistoryCaps = {
  trades: 200,
  settlements: 200,
  ledger: 200,
  transactions: 200,
  notifications: 100,
  botRuns: 50,
  deposits: 50,
  withdrawals: 50,
  tickets: 50,
};

const DEMO_HISTORY_CAPS_TIGHT: DemoHistoryCaps = {
  trades: 40,
  settlements: 40,
  ledger: 40,
  transactions: 40,
  notifications: 20,
  botRuns: 10,
  deposits: 10,
  withdrawals: 10,
  tickets: 10,
};

function emptyWallet(now: string): Wallet {
  return {
    id: DEMO_WALLET_ID,
    userId: DEMO_USER_ID,
    accountId: DEMO_ACCOUNT_ID,
    accountMode: "demo",
    kind: "demo",
    currency: "USD",
    balance: DEMO_STARTING_BALANCE,
    availableBalance: DEMO_STARTING_BALANCE,
    lockedBalance: 0,
    status: "ready",
    isSimulated: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function createInitialDemoState(now = Date.now()): DemoState {
  const createdAt = nowIso(now);
  return {
    account: {
      id: DEMO_ACCOUNT_ID,
      userId: DEMO_USER_ID,
      accountMode: "demo",
      status: "active",
      createdAt,
      updatedAt: createdAt,
    },
    wallet: emptyWallet(createdAt),
    ledger: [],
    transactions: [],
    deposits: [],
    withdrawals: [],
    trades: [],
    settlements: [],
    botRuns: [],
    notifications: [],
    tickets: [],
  };
}

let memory: DemoState | null = null;
let memoryOwner = "";

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function revive(raw: DemoState): DemoState {
  assertSameMode("demo", raw.account.accountMode, "demo account");
  assertSameMode("demo", raw.wallet.accountMode, "demo wallet");
  const trades = (raw.trades ?? []).map((trade) => {
    const legacy = trade as Trade & { side?: string };
    const contractType = legacy.contractType ?? "EVEN_ODD";
    const contractOption =
      legacy.contractOption ??
      (legacy.side === "put" || legacy.side === "odd" ? "odd" : "even");
    return {
      ...legacy,
      market: legacy.market ?? legacy.symbol,
      contractType,
      contractOption,
      selectedDigit: legacy.selectedDigit ?? null,
      barrier: legacy.barrier ?? null,
      duration: legacy.duration ?? legacy.durationMs,
      result: legacy.result ?? legacy.status,
      resolvedAt:
        legacy.resolvedAt ??
        (legacy.status === "open" ? null : legacy.updatedAt),
    } satisfies Trade;
  });
  for (const trade of trades)
    assertSameMode("demo", trade.accountMode, "demo trade");
  for (const tx of raw.transactions)
    assertSameMode("demo", tx.accountMode, "demo transaction");
  return { ...raw, trades };
}

function sessionEmail(): string {
  return loadDemoSession()?.email?.trim().toLowerCase() ?? "";
}

function storageKeyFor(email: string): string {
  return email ? `${DEMO_STORAGE_KEY}:${email}` : DEMO_STORAGE_KEY;
}

function takeNewest<T>(rows: T[] | undefined, limit: number): T[] {
  if (!rows?.length) return [];
  return rows.length > limit ? rows.slice(0, limit) : rows;
}

function pruneDemoState(
  state: DemoState,
  caps: DemoHistoryCaps = DEMO_HISTORY_CAPS,
): DemoState {
  const open = (state.trades ?? []).filter((trade) => trade.status === "open");
  const closed = (state.trades ?? []).filter((trade) => trade.status !== "open");
  const closedCap = Math.max(0, caps.trades - open.length);
  return {
    ...state,
    trades: [...open, ...takeNewest(closed, closedCap)],
    settlements: takeNewest(state.settlements, caps.settlements),
    ledger: takeNewest(state.ledger, caps.ledger),
    transactions: takeNewest(state.transactions, caps.transactions),
    notifications: takeNewest(state.notifications, caps.notifications),
    botRuns: takeNewest(state.botRuns, caps.botRuns),
    deposits: takeNewest(state.deposits, caps.deposits),
    withdrawals: takeNewest(state.withdrawals, caps.withdrawals),
    tickets: takeNewest(state.tickets, caps.tickets),
  };
}

function isQuotaExceeded(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as DOMException;
  return (
    err.name === "QuotaExceededError" ||
    err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    err.code === 22 ||
    err.code === 1014
  );
}

function writeDemoStorage(key: string, state: DemoState): DemoState {
  let next = pruneDemoState(state);
  if (!canUseStorage()) return next;
  try {
    localStorage.setItem(key, JSON.stringify(next));
    return next;
  } catch (error) {
    if (!isQuotaExceeded(error)) throw error;
  }
  next = pruneDemoState(next, DEMO_HISTORY_CAPS_TIGHT);
  try {
    localStorage.setItem(key, JSON.stringify(next));
    return next;
  } catch (error) {
    if (!isQuotaExceeded(error)) throw error;
  }
  // Drop other demo accounts / legacy key to free quota, then retry once.
  try {
    const prefix = `${DEMO_STORAGE_KEY}:`;
    const drop: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const item = localStorage.key(i);
      if (!item) continue;
      if (item === key) continue;
      if (item === DEMO_STORAGE_KEY || item.startsWith(prefix)) drop.push(item);
    }
    for (const item of drop) localStorage.removeItem(item);
    localStorage.setItem(key, JSON.stringify(next));
    return next;
  } catch (error) {
    if (!isQuotaExceeded(error)) throw error;
  }
  // Last resort: wallet + open trades only (keeps balance usable).
  next = {
    ...createInitialDemoState(),
    wallet: next.wallet,
    account: next.account,
    trades: (next.trades ?? []).filter((trade) => trade.status === "open"),
  };
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Memory still holds the pruned state; UI keeps working this session.
  }
  return next;
}

function readStored(key: string): DemoState | null {
  if (!canUseStorage()) return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return pruneDemoState(revive(JSON.parse(raw) as DemoState));
  } catch {
    return null;
  }
}

export function loadDemoState(): DemoState {
  const email = sessionEmail();
  if (memory && memoryOwner === email) return memory;
  memoryOwner = email;
  const key = storageKeyFor(email);
  const stored = readStored(key);
  if (stored) {
    memory = stored;
    return memory;
  }
  if (email) {
    const legacy = readStored(DEMO_STORAGE_KEY);
    if (legacy) {
      memory = writeDemoStorage(key, legacy);
      if (canUseStorage()) localStorage.removeItem(DEMO_STORAGE_KEY);
      return memory;
    }
  }
  memory = createInitialDemoState();
  persistDemoState(memory);
  return memory;
}

export function listStoredDemoStates(): Array<{
  email: string;
  state: DemoState;
}> {
  const rows: Array<{ email: string; state: DemoState }> = [];
  const seen = new Set<string>();
  if (canUseStorage()) {
    const prefix = `${DEMO_STORAGE_KEY}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const email = key.slice(prefix.length);
      const stored = readStored(key);
      if (!stored) continue;
      seen.add(email);
      rows.push({ email, state: stored });
    }
  }
  const current = sessionEmail();
  if (current && !seen.has(current))
    rows.push({ email: current, state: loadDemoState() });
  return rows;
}

export function moveStoredDemoState(fromEmail: string, toEmail: string): void {
  const from = fromEmail.trim().toLowerCase();
  const to = toEmail.trim().toLowerCase();
  if (!from || !to || from === to) return;
  const source = readStored(storageKeyFor(from));
  if (source && canUseStorage()) {
    writeDemoStorage(storageKeyFor(to), source);
    localStorage.removeItem(storageKeyFor(from));
  }
  if (memoryOwner === from) {
    memory = source ? pruneDemoState(source) : memory;
    memoryOwner = to;
  }
}

export function updateStoredDemoState(
  email: string,
  mutator: (state: DemoState) => DemoState,
): void {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  if (normalized === sessionEmail()) {
    mutateDemoState(mutator);
    return;
  }
  if (!canUseStorage()) return;
  const key = storageKeyFor(normalized);
  const stored = readStored(key) ?? createInitialDemoState();
  writeDemoStorage(key, mutator(stored));
}

export function peekDemoAvailable(email: string): number {
  const normalized = email.trim().toLowerCase();
  const stored = readStored(storageKeyFor(normalized));
  if (stored?.wallet.availableBalance != null)
    return stored.wallet.availableBalance;
  if (normalized && normalized === sessionEmail()) {
    const legacy = readStored(DEMO_STORAGE_KEY);
    if (legacy?.wallet.availableBalance != null)
      return legacy.wallet.availableBalance;
  }
  return DEMO_STARTING_BALANCE;
}

export function persistDemoState(state: DemoState): void {
  memoryOwner = sessionEmail();
  memory = writeDemoStorage(storageKeyFor(memoryOwner), state);
  listeners.forEach((listener) => listener());
}

export function resetDemoState(now = Date.now()): DemoState {
  memory = createInitialDemoState(now);
  persistDemoState(memory);
  return memory;
}

export function subscribeDemoStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function mutateDemoState(
  mutator: (state: DemoState) => DemoState,
): DemoState {
  const next = mutator(loadDemoState());
  persistDemoState(next);
  return next;
}

export function isTradeResultNotification(title: string): boolean {
  return /\btrade\b/i.test(title) && /\b(won|lost)\b/i.test(title);
}

export function pushDemoNotification(
  state: DemoState,
  kind: NotificationKind,
  title: string,
  body: string,
  now = Date.now(),
): DemoState {
  const createdAt = nowIso(now);
  const notification: Notification = {
    id: createId("ntf"),
    userId: DEMO_USER_ID,
    accountId: DEMO_ACCOUNT_ID,
    accountMode: "demo",
    kind,
    title,
    body,
    read: false,
    isSimulated: true,
    createdAt,
    updatedAt: createdAt,
  };
  return { ...state, notifications: [notification, ...state.notifications] };
}

export function replenishDemoBalance(now = Date.now()): DemoState {
  return mutateDemoState((state) => {
    const locked = state.wallet.lockedBalance ?? 0;
    const previous = state.wallet.availableBalance ?? 0;
    if (previous === DEMO_STARTING_BALANCE) return state;
    const updatedAt = nowIso(now);
    let next: DemoState = {
      ...state,
      wallet: {
        ...state.wallet,
        availableBalance: DEMO_STARTING_BALANCE,
        lockedBalance: locked,
        balance: DEMO_STARTING_BALANCE + locked,
        updatedAt,
      },
    };
    next = appendDemoLedger(
      next,
      {
        entryType: "adjustment",
        amount: DEMO_STARTING_BALANCE - previous,
        referenceId: null,
        note: `${demoAccountShort()} balance replenished to 10,000 USD`,
        balanceAfter: DEMO_STARTING_BALANCE + locked,
      },
      now,
    );
    return pushDemoNotification(
      next,
      "wallet",
      `${demoAccountShort()} balance replenished`,
      `Your ${demoAccountShort()} balance is 10,000 USD of virtual real funds.`,
      now,
    );
  });
}

export function applyDemoBalance(
  state: DemoState,
  deltaAvailable: number,
  deltaLocked: number,
  now: number,
): DemoState {
  const available = Math.max(
    0,
    (state.wallet.availableBalance ?? 0) + deltaAvailable,
  );
  const locked = Math.max(0, (state.wallet.lockedBalance ?? 0) + deltaLocked);
  const updatedAt = nowIso(now);
  return {
    ...state,
    wallet: {
      ...state.wallet,
      availableBalance: available,
      lockedBalance: locked,
      balance: available + locked,
      updatedAt,
    },
  };
}

export function appendDemoLedger(
  state: DemoState,
  entry: Omit<
    WalletLedger,
    | "id"
    | "userId"
    | "accountId"
    | "accountMode"
    | "walletId"
    | "isSimulated"
    | "createdAt"
    | "updatedAt"
    | "balanceAfter"
  > & {
    balanceAfter?: number | null;
  },
  now: number,
): DemoState {
  const createdAt = nowIso(now);
  const ledgerEntry: WalletLedger = {
    id: createId("ldg"),
    userId: DEMO_USER_ID,
    accountId: DEMO_ACCOUNT_ID,
    accountMode: "demo",
    walletId: DEMO_WALLET_ID,
    isSimulated: true,
    createdAt,
    updatedAt: createdAt,
    balanceAfter: entry.balanceAfter ?? state.wallet.balance,
    ...entry,
  };
  return { ...state, ledger: [ledgerEntry, ...state.ledger] };
}

export function adjustStoredDemoAvailable(
  email: string,
  delta: number,
): number | null {
  const normalized = email.trim().toLowerCase();
  const amount = Math.round(delta * 100) / 100;
  if (!normalized || !Number.isFinite(amount) || amount === 0) return null;
  const current = peekDemoAvailable(normalized);
  const next = Math.round((current + amount) * 100) / 100;
  if (next < 0) return null;
  const now = Date.now();
  const note =
    amount > 0 ? "Admin added demo funds" : "Admin subtracted demo funds";
  updateStoredDemoState(normalized, (state) => {
    const applied = applyDemoBalance(
      state,
      next - (state.wallet.availableBalance ?? 0),
      0,
      now,
    );
    const withLedger = appendDemoLedger(
      applied,
      {
        entryType: "adjustment",
        amount,
        referenceId: null,
        note,
        balanceAfter: applied.wallet.balance,
      },
      now,
    );
    const createdAt = nowIso(now);
    const transaction: Transaction = {
      id: createId("tx"),
      userId: DEMO_USER_ID,
      accountId: DEMO_ACCOUNT_ID,
      accountMode: "demo",
      walletId: DEMO_WALLET_ID,
      type: "adjustment",
      amount,
      currency: "USD",
      status: "COMPLETED",
      reference: null,
      note,
      isSimulated: true,
      createdAt,
      updatedAt: createdAt,
    };
    return pushDemoNotification(
      {
        ...withLedger,
        transactions: [transaction, ...withLedger.transactions],
      },
      "wallet",
      amount > 0
        ? `${demoAccountShort().toUpperCase()} funds added`
        : `${demoAccountShort().toUpperCase()} funds subtracted`,
      `Your ${demoAccountShort()} balance is now ${next.toFixed(2)} USD.`,
      now,
    );
  });
  return next;
}

subscribeDemoSession(() => {
  memory = null;
  memoryOwner = "\0";
  listeners.forEach((listener) => listener());
});
