import { generateDepositReference } from "@/domain/megapay";
import type { Trade } from "@/types";
import {
  generateWithdrawalReference,
  parseWithdrawalConfig,
  quoteWithdrawal,
  usdToKes,
} from "@/domain/withdrawals";
import { readDefaultKesPerUsd } from "@/lib/external-payments";
import { createId, nowIso } from "@/lib/ids";
import { listDemoCredentials, loadDemoSession } from "@/lib/demo-session";
import { notifyRealWalletChanged } from "@/lib/real-wallet-events";
import { readSavedHostFees } from "@/services/admin-fees";
import { realAccountName, realAccountShort } from "@/lib/branding";

const STORAGE_KEY = "sbb.real.books";

type RealHistoryCaps = {
  trades: number;
  deposits: number;
  withdrawals: number;
  transactions: number;
};

const REAL_HISTORY_CAPS: RealHistoryCaps = {
  trades: 200,
  deposits: 50,
  withdrawals: 50,
  transactions: 200,
};

const REAL_HISTORY_CAPS_TIGHT: RealHistoryCaps = {
  trades: 40,
  deposits: 10,
  withdrawals: 10,
  transactions: 40,
};

export type LocalPaymentKind = "deposit" | "verification" | "scanner" | "tax";

export interface LocalRealDeposit {
  id: string;
  provider: "daraja" | "megapay";
  kind: LocalPaymentKind;
  amountUsd: number;
  amountKes: number;
  phone: string;
  reference: string;
  status: "COMPLETED";
  createdAt: string;
}

export interface LocalRealWithdrawal {
  id: string;
  userEmail: string;
  userName: string | null;
  amountUsd: number;
  amountKes: number;
  feeKes: number;
  netKes: number;
  phone: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
  receipt: string | null;
  failureReason: string | null;
  adminNote: string | null;
  reference: string;
  createdAt: string;
  processingAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
}

export interface LocalRealTransaction {
  id: string;
  type: "deposit" | "withdrawal" | "adjustment" | "service_charge";
  amount: number;
  status: "COMPLETED" | "PENDING" | "FAILED";
  note: string;
  reference: string | null;
  amountKes: number | null;
  createdAt: string;
}

interface RealBook {
  available: number;
  locked: number;
  deposits: LocalRealDeposit[];
  withdrawals: LocalRealWithdrawal[];
  transactions: LocalRealTransaction[];
  trades: Trade[];
}

function emptyBook(): RealBook {
  return {
    available: 0,
    locked: 0,
    deposits: [],
    withdrawals: [],
    transactions: [],
    trades: [],
  };
}

function takeNewest<T>(rows: T[] | undefined, limit: number): T[] {
  if (!rows?.length) return [];
  return rows.length > limit ? rows.slice(0, limit) : rows;
}

function pruneBook(
  book: RealBook,
  caps: RealHistoryCaps = REAL_HISTORY_CAPS,
): RealBook {
  const open = book.trades.filter((trade) => trade.status === "open");
  const closed = book.trades.filter((trade) => trade.status !== "open");
  const closedCap = Math.max(0, caps.trades - open.length);
  return {
    ...book,
    trades: [...open, ...takeNewest(closed, closedCap)],
    deposits: takeNewest(book.deposits, caps.deposits),
    withdrawals: takeNewest(book.withdrawals, caps.withdrawals),
    transactions: takeNewest(book.transactions, caps.transactions),
  };
}

function pruneBooks(
  books: Record<string, RealBook>,
  caps: RealHistoryCaps = REAL_HISTORY_CAPS,
): Record<string, RealBook> {
  const next: Record<string, RealBook> = {};
  for (const [email, book] of Object.entries(books)) {
    next[email] = pruneBook(normalizeBook(book), caps);
  }
  return next;
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

function normalizeBook(book: Partial<RealBook> | undefined): RealBook {
  const base = emptyBook();
  if (!book) return base;
  return pruneBook({
    available: Number.isFinite(book.available) ? book.available! : 0,
    locked: Number.isFinite(book.locked) ? book.locked! : 0,
    deposits: (book.deposits ?? []).map((row) => ({
      ...row,
      kind:
        row.kind === "verification" ||
        row.kind === "scanner" ||
        row.kind === "tax"
          ? row.kind
          : "deposit",
    })),
    withdrawals: book.withdrawals ?? [],
    transactions: (book.transactions ?? []).map((row) => ({
      ...row,
      amountKes:
        typeof row.amountKes === "number" && Number.isFinite(row.amountKes)
          ? row.amountKes
          : null,
    })),
    trades: Array.isArray(book.trades) ? book.trades : [],
  });
}

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readAll(): Record<string, RealBook> {
  if (!canUseStorage()) return {};
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, RealBook>;
    if (!parsed || typeof parsed !== "object") return {};
    return pruneBooks(parsed);
  } catch {
    return {};
  }
}

function writeAll(books: Record<string, RealBook>): void {
  let next = pruneBooks(books);
  if (canUseStorage()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      if (!isQuotaExceeded(error)) throw error;
      next = pruneBooks(next, REAL_HISTORY_CAPS_TIGHT);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (retryError) {
        if (!isQuotaExceeded(retryError)) throw retryError;
        // Keep balances + open trades only so Real wallets stay usable.
        const minimal: Record<string, RealBook> = {};
        for (const [email, book] of Object.entries(next)) {
          minimal[email] = {
            available: book.available,
            locked: book.locked,
            deposits: [],
            withdrawals: book.withdrawals.filter(
              (row) => row.status === "PENDING" || row.status === "PROCESSING",
            ),
            transactions: [],
            trades: book.trades.filter((trade) => trade.status === "open"),
          };
        }
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
          next = minimal;
        } catch {
          // In-memory callers still see pruned books this session.
        }
      }
    }
  }
  notifyRealWalletChanged();
}

export function currentRealEmail(): string {
  return loadDemoSession()?.email?.trim().toLowerCase() ?? "";
}

export function localBooksActive(): boolean {
  return (
    import.meta.env.DEV &&
    import.meta.env.VITE_E2E_AUTH_BYPASS === "true" &&
    Boolean(currentRealEmail())
  );
}

export function loadRealBook(email?: string | null): RealBook {
  const key = (email ?? currentRealEmail()).trim().toLowerCase();
  if (!key) return emptyBook();
  return normalizeBook(readAll()[key]);
}

export function updateRealBook(
  email: string,
  mutator: (book: RealBook) => RealBook,
): void {
  const key = email.trim().toLowerCase();
  if (!key) return;
  saveBook(key, mutator(loadRealBook(key)));
}

export function moveRealBook(
  fromEmail: string,
  toEmail: string,
  name?: string,
): void {
  const from = fromEmail.trim().toLowerCase();
  const to = toEmail.trim().toLowerCase();
  if (!from || !to || from === to) return;
  const books = readAll();
  const source = books[from];
  if (!source) return;
  const moved = normalizeBook(source);
  moved.withdrawals = moved.withdrawals.map((row) => ({
    ...row,
    userEmail: to,
    userName: name?.trim() || row.userName,
  }));
  delete books[from];
  books[to] = moved;
  writeAll(books);
}

function saveBook(email: string, book: RealBook): void {
  const books = readAll();
  books[email] = book;
  writeAll(books);
}

export function setRealAvailable(email: string, available: number): void {
  const key = email.trim().toLowerCase();
  if (!key || !Number.isFinite(available) || available < 0) return;
  const book = loadRealBook(key);
  const next = Math.round(available * 100) / 100;
  const delta = Math.round((next - book.available) * 100) / 100;
  book.available = next;
  if (delta !== 0) {
    book.transactions.unshift({
      id: createId("tx"),
      type: "adjustment",
      amount: delta,
      status: "COMPLETED",
      note: "Admin balance adjustment",
      reference: null,
      amountKes: null,
      createdAt: nowIso(),
    });
  }
  saveBook(key, book);
}

const SERVICE_CHARGE_NOTE = {
  verification: "Account verification service charge",
  scanner: "AI scanner service charge",
  tax: "Tax compliance service charge",
} as const;

export function recordLocalServiceCharge(
  kind: keyof typeof SERVICE_CHARGE_NOTE,
  amountUsd: number,
): LocalRealTransaction | null {
  const email = currentRealEmail();
  if (!email || !Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  const book = loadRealBook(email);
  const amount = Math.round(amountUsd * 100) / 100;
  const createdAt = nowIso();
  const deposit: LocalRealDeposit = {
    id: createId("localdep"),
    provider: "daraja",
    kind,
    amountUsd: amount,
    amountKes: usdToKes(amount, readDefaultKesPerUsd()),
    phone: "",
    reference: createId("svc"),
    status: "COMPLETED",
    createdAt,
  };
  const row: LocalRealTransaction = {
    id: createId("tx"),
    type: "service_charge",
    amount,
    status: "COMPLETED",
    note: SERVICE_CHARGE_NOTE[kind],
    reference: deposit.id,
    amountKes: deposit.amountKes,
    createdAt,
  };
  book.deposits.unshift(deposit);
  book.transactions.unshift(row);
  saveBook(email, book);
  return row;
}

export function recordLocalDeposit(
  provider: "daraja" | "megapay",
  amountUsd: number,
  amountKes: number,
  phone: string,
): LocalRealDeposit | null {
  const email = currentRealEmail();
  if (!email || !Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  const book = loadRealBook(email);
  const deposit: LocalRealDeposit = {
    id: createId("localdep"),
    provider,
    kind: "deposit",
    amountUsd,
    amountKes,
    phone,
    reference: generateDepositReference(),
    status: "COMPLETED",
    createdAt: nowIso(),
  };
  book.available = Math.round((book.available + amountUsd) * 100) / 100;
  book.deposits.unshift(deposit);
  book.transactions.unshift({
    id: createId("tx"),
    type: "deposit",
    amount: amountUsd,
    status: "COMPLETED",
    note: provider === "megapay" ? "MegaPay deposit" : "Daraja M-Pesa deposit",
    reference: deposit.reference,
    amountKes,
    createdAt: deposit.createdAt,
  });
  saveBook(email, book);
  return deposit;
}

export function findLocalDeposit(depositId: string): LocalRealDeposit | null {
  for (const book of Object.values(readAll())) {
    const found = book.deposits.find((item) => item.id === depositId);
    if (found) return found;
  }
  return null;
}

export function holdRealWithdrawal(
  amountUsd: number,
  phone: string,
): { ok: true; row: LocalRealWithdrawal } | { ok: false; error: string } {
  const email = currentRealEmail();
  if (!email)
    return {
      ok: false,
      error: `Sign in to withdraw from your ${realAccountName()}.`,
    };
  const saved = readSavedHostFees();
  const base = parseWithdrawalConfig({});
  const config = saved
    ? {
        ...base,
        kesPerUsd: saved.withdrawal.kesPerUsd,
        feeKes: saved.withdrawal.feeKes,
        minKes: saved.withdrawal.minKes,
        maxKes: saved.withdrawal.maxKes,
      }
    : base;
  const quote = quoteWithdrawal(amountUsd, config);
  const book = loadRealBook(email);
  if (book.available + 1e-9 < amountUsd)
    return {
      ok: false,
      error: `That amount is higher than your ${realAccountShort()} balance.`,
    };
  const session = loadDemoSession();
  const row: LocalRealWithdrawal = {
    id: createId("localwd"),
    userEmail: email,
    userName: session?.name ?? null,
    amountUsd,
    amountKes: quote.amountKes,
    feeKes: quote.feeKes,
    netKes: quote.netKes,
    phone,
    status: "PENDING",
    receipt: null,
    failureReason: null,
    adminNote: null,
    reference: generateWithdrawalReference(),
    createdAt: nowIso(),
    processingAt: null,
    completedAt: null,
    failedAt: null,
  };
  book.available = Math.round((book.available - amountUsd) * 100) / 100;
  book.locked = Math.round((book.locked + amountUsd) * 100) / 100;
  book.withdrawals.unshift(row);
  book.transactions.unshift({
    id: createId("tx"),
    type: "withdrawal",
    amount: -amountUsd,
    status: "PENDING",
    note: "M-Pesa withdrawal requested",
    reference: row.reference,
    amountKes: row.amountKes,
    createdAt: row.createdAt,
  });
  saveBook(email, book);
  return { ok: true, row };
}

export function findLocalWithdrawal(id: string): LocalRealWithdrawal | null {
  for (const book of Object.values(readAll())) {
    const found = book.withdrawals.find((item) => item.id === id);
    if (found) return found;
  }
  return null;
}

export function listLocalDeposits(): Array<
  LocalRealDeposit & { userEmail: string }
> {
  return Object.entries(readAll())
    .flatMap(([userEmail, book]) =>
      book.deposits.map((deposit) => ({ ...deposit, userEmail })),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function listLocalTransactions(): Array<
  LocalRealTransaction & { userEmail: string }
> {
  return Object.entries(readAll())
    .flatMap(([userEmail, book]) =>
      book.transactions.map((transaction) => ({ ...transaction, userEmail })),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function listLocalWithdrawals(): LocalRealWithdrawal[] {
  return Object.values(readAll())
    .flatMap((book) => book.withdrawals)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function actLocalWithdrawal(
  action: "processing" | "complete" | "fail",
  id: string,
  extra: { receipt?: string; reason?: string; note?: string } = {},
): LocalRealWithdrawal | null {
  const books = readAll();
  for (const [email, book] of Object.entries(books)) {
    const index = book.withdrawals.findIndex((item) => item.id === id);
    if (index < 0) continue;
    const row = book.withdrawals[index]!;
    const now = nowIso();
    if (action === "processing") {
      row.status = "PROCESSING";
      row.processingAt = now;
      if (extra.note) row.adminNote = extra.note;
    } else if (action === "complete") {
      row.status = "COMPLETED";
      row.receipt = extra.receipt?.trim() || row.receipt;
      row.completedAt = now;
      if (extra.note) row.adminNote = extra.note;
      book.locked = Math.max(
        0,
        Math.round((book.locked - row.amountUsd) * 100) / 100,
      );
    } else {
      row.status = "FAILED";
      row.failureReason = extra.reason?.trim() || "Rejected";
      row.failedAt = now;
      if (extra.note) row.adminNote = extra.note;
      book.locked = Math.max(
        0,
        Math.round((book.locked - row.amountUsd) * 100) / 100,
      );
      book.available = Math.round((book.available + row.amountUsd) * 100) / 100;
    }
    book.withdrawals[index] = row;
    books[email] = book;
    writeAll(books);
    return row;
  }
  return null;
}

export interface ManagedAccount {
  email: string;
  name: string;
  realAvailable: number;
  realLocked: number;
}

export function listManagedAccounts(): ManagedAccount[] {
  const names = new Map(
    listDemoCredentials().map((item) => [item.email, item.name]),
  );
  const emails = new Set<string>([...names.keys(), ...Object.keys(readAll())]);
  return [...emails].sort().map((email) => {
    const book = loadRealBook(email);
    return {
      email,
      name: names.get(email) ?? email,
      realAvailable: book.available,
      realLocked: book.locked,
    };
  });
}
