import { demoAccountShort, realAccountShort } from "@/lib/branding";
import { roleWithAdminList } from "@/lib/admin-emails";
import { listDemoCredentials } from "@/lib/demo-session";
import { DEMO_STARTING_BALANCE } from "@/providers/config";
import {
  adjustStoredDemoAvailable,
  listStoredDemoStates,
  peekDemoAvailable,
  isTradeResultNotification,
  pushDemoNotification,
  updateStoredDemoState,
} from "@/lib/demo-store";
import { nowIso } from "@/lib/ids";
import {
  listLocalDeposits,
  listLocalTransactions,
  listLocalWithdrawals,
  listManagedAccounts,
  loadRealBook,
  setRealAvailable,
  type LocalPaymentKind,
} from "@/lib/real-books";
import type {
  Deposit,
  Notification,
  SupportTicket,
  Trade,
  Withdrawal,
} from "@/types";

export interface AdminUserRow {
  email: string;
  name: string;
  phone: string;
  country: string;
  role: string;
  createdAt: string;
  demoAvailable: number;
  realAvailable: number;
  realLocked: number;
}

export interface TaggedDeposit extends Deposit {
  ownerEmail: string;
}

export interface TaggedWithdrawal extends Withdrawal {
  ownerEmail: string;
}

export interface TaggedTrade extends Trade {
  ownerEmail: string;
}

export interface TaggedTicket extends SupportTicket {
  ownerEmail: string;
}

export interface TaggedNotification extends Notification {
  ownerEmail: string;
}

export interface LedgerRow {
  id: string;
  ownerEmail: string;
  accountMode: "demo" | "real";
  type: string;
  amount: number;
  amountKes: number | null;
  status: string;
  note: string;
  createdAt: string;
}

export interface SuccessfulPayment {
  id: string;
  email: string;
  payment: string;
  usd: number;
  kes: number | null;
  method: string;
  reference: string;
  createdAt: string;
}

const PAYMENT_LABEL: Record<LocalPaymentKind, string> = {
  deposit: "Deposit",
  verification: "Account verification",
  scanner: "AI scanner",
  tax: "Tax compliance",
};

function paymentKindFromNote(note: string): LocalPaymentKind | null {
  if (note.includes("Account verification")) return "verification";
  if (note.includes("AI scanner")) return "scanner";
  if (note.includes("Tax compliance")) return "tax";
  return null;
}

export function successfulRealPayments(): SuccessfulPayment[] {
  const deposits = listLocalDeposits().filter(
    (row) => row.status === "COMPLETED",
  );
  const covered = new Set(
    deposits
      .filter((row) => row.kind !== "deposit")
      .map(
        (row) =>
          `${row.userEmail}|${row.kind}|${row.amountUsd}|${row.createdAt}`,
      ),
  );
  const rows: SuccessfulPayment[] = deposits.map((row) => ({
    id: row.id,
    email: row.userEmail,
    payment: PAYMENT_LABEL[row.kind],
    usd: row.amountUsd,
    kes: row.amountKes,
    method: "M-Pesa",
    reference: row.reference,
    createdAt: row.createdAt,
  }));
  for (const entry of listLocalTransactions()) {
    if (entry.type !== "service_charge" || entry.status !== "COMPLETED")
      continue;
    const kind = paymentKindFromNote(entry.note);
    if (!kind) continue;
    const key = `${entry.userEmail}|${kind}|${entry.amount}|${entry.createdAt}`;
    if (covered.has(key)) continue;
    rows.push({
      id: entry.id,
      email: entry.userEmail,
      payment: PAYMENT_LABEL[kind],
      usd: entry.amount,
      kes: entry.amountKes,
      method: "M-Pesa",
      reference: entry.reference ?? "—",
      createdAt: entry.createdAt,
    });
  }
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export interface AdminDesk {
  users: AdminUserRow[];
  demoDeposits: TaggedDeposit[];
  realDeposits: Array<ReturnType<typeof listLocalDeposits>[number]>;
  realPayments: SuccessfulPayment[];
  demoWithdrawals: TaggedWithdrawal[];
  realWithdrawals: ReturnType<typeof listLocalWithdrawals>;
  demoTrades: TaggedTrade[];
  ledger: LedgerRow[];
  tickets: TaggedTicket[];
  notifications: TaggedNotification[];
}

export function loadAdminDesk(): AdminDesk {
  const credentials = listDemoCredentials();
  const names = new Map(credentials.map((item) => [item.email, item]));
  const managed = listManagedAccounts();
  const emails = new Set<string>([
    ...names.keys(),
    ...managed.map((item) => item.email),
  ]);
  const users: AdminUserRow[] = [...emails].sort().map((email) => {
    const person = names.get(email);
    const book = loadRealBook(email);
    return {
      email,
      name: person?.name ?? email,
      phone: person?.phone ?? "",
      country: person?.country ?? "",
      role: roleWithAdminList(email, "trader"),
      createdAt: person?.createdAt ?? "",
      demoAvailable: peekDemoAvailable(email),
      realAvailable: book.available,
      realLocked: book.locked,
    };
  });

  const demoDeposits: TaggedDeposit[] = [];
  const demoWithdrawals: TaggedWithdrawal[] = [];
  const demoTrades: TaggedTrade[] = [];
  const ledger: LedgerRow[] = [];
  const tickets: TaggedTicket[] = [];
  const notifications: TaggedNotification[] = [];

  for (const { email, state } of listStoredDemoStates()) {
    for (const deposit of state.deposits)
      demoDeposits.push({ ...deposit, ownerEmail: email });
    for (const withdrawal of state.withdrawals)
      demoWithdrawals.push({ ...withdrawal, ownerEmail: email });
    for (const trade of state.trades)
      demoTrades.push({ ...trade, ownerEmail: email });
    for (const ticket of state.tickets)
      tickets.push({ ...ticket, ownerEmail: email });
    for (const notification of state.notifications) {
      if (isTradeResultNotification(notification.title)) continue;
      notifications.push({ ...notification, ownerEmail: email });
    }
    for (const entry of state.transactions) {
      ledger.push({
        id: entry.id,
        ownerEmail: email,
        accountMode: "demo",
        type: entry.type,
        amount: entry.amount,
        amountKes: null,
        status: entry.status,
        note: entry.note ?? "",
        createdAt: entry.createdAt,
      });
    }
  }

  for (const entry of listLocalTransactions()) {
    ledger.push({
      id: entry.id,
      ownerEmail: entry.userEmail,
      accountMode: "real",
      type: entry.type,
      amount: entry.amount,
      amountKes: entry.amountKes,
      status: entry.status,
      note: entry.note,
      createdAt: entry.createdAt,
    });
  }

  const byTime = <T extends { createdAt: string }>(rows: T[]) =>
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return {
    users,
    demoDeposits: byTime(demoDeposits),
    realDeposits: listLocalDeposits(),
    realPayments: successfulRealPayments(),
    demoWithdrawals: byTime(demoWithdrawals),
    realWithdrawals: listLocalWithdrawals(),
    demoTrades: byTime(demoTrades),
    ledger: byTime(ledger),
    tickets: byTime(tickets),
    notifications: byTime(notifications),
  };
}

export function adjustRealBalance(email: string, available: number): void {
  setRealAvailable(email, available);
}

export function adjustUserBalance(
  email: string,
  mode: "demo" | "real",
  delta: number,
): { ok: true; available: number } | { ok: false; error: string } {
  const amount = Math.round(delta * 100) / 100;
  const key = email.trim().toLowerCase();
  if (!key) return { ok: false, error: "Choose a user." };
  if (!Number.isFinite(amount) || amount === 0)
    return { ok: false, error: "Enter an amount above zero." };
  if (mode === "demo") {
    const available = adjustStoredDemoAvailable(key, amount);
    if (available == null)
      return {
        ok: false,
        error: `That would take the ${demoAccountShort().toLowerCase()} balance below zero.`,
      };
    return { ok: true, available };
  }
  const current = loadRealBook(key).available;
  const available = Math.round((current + amount) * 100) / 100;
  if (available < 0)
    return {
      ok: false,
      error: `That would take the ${realAccountShort().toLowerCase()} balance below zero.`,
    };
  setRealAvailable(key, available);
  return { ok: true, available };
}

export function closeSupportTicket(email: string, ticketId: string): void {
  updateStoredDemoState(email, (state) => ({
    ...state,
    tickets: state.tickets.map((ticket) =>
      ticket.id === ticketId
        ? { ...ticket, status: "closed", updatedAt: nowIso() }
        : ticket,
    ),
  }));
}

export function replySupportTicket(
  email: string,
  ticketId: string,
  reply: string,
): { ok: true } | { ok: false; error: string } {
  const text = reply.trim();
  if (text.length < 2) return { ok: false, error: "Enter a reply." };
  let found = false;
  updateStoredDemoState(email, (state) => {
    const tickets = state.tickets.map((ticket) => {
      if (ticket.id !== ticketId) return ticket;
      found = true;
      const stamp = nowIso();
      return {
        ...ticket,
        reply: text,
        replyAt: stamp,
        replyRead: false,
        updatedAt: stamp,
      };
    });
    if (!found) return state;
    return pushDemoNotification(
      { ...state, tickets },
      "system",
      "New support reply",
      text,
    );
  });
  if (!found) return { ok: false, error: "That ticket was not found." };
  return { ok: true };
}

export function markSupportRepliesRead(email: string): void {
  updateStoredDemoState(email, (state) => ({
    ...state,
    tickets: state.tickets.map((ticket) =>
      ticket.reply && ticket.replyRead !== true
        ? { ...ticket, replyRead: true }
        : ticket,
    ),
    notifications: state.notifications.map((item) =>
      item.title === "New support reply" && !item.read
        ? { ...item, read: true, updatedAt: nowIso() }
        : item,
    ),
  }));
}

export function broadcastAdminNotification(
  title: string,
  body: string,
): number {
  const emails = new Set<string>([
    ...listDemoCredentials().map((item) => item.email),
    ...listStoredDemoStates().map((item) => item.email),
  ]);
  let count = 0;
  for (const email of emails) {
    updateStoredDemoState(email, (state) =>
      pushDemoNotification(state, "system", title, body),
    );
    count += 1;
  }
  return count;
}

export function resetAllDemoBalances(): number {
  const emails = new Set<string>([
    ...listDemoCredentials().map((item) => item.email),
    ...listStoredDemoStates().map((item) => item.email),
  ]);
  for (const email of emails) {
    updateStoredDemoState(email, (state) => {
      const locked = state.wallet.lockedBalance ?? 0;
      return {
        ...state,
        wallet: {
          ...state.wallet,
          availableBalance: DEMO_STARTING_BALANCE,
          lockedBalance: locked,
          balance: DEMO_STARTING_BALANCE + locked,
          updatedAt: nowIso(),
        },
      };
    });
  }
  return emails.size;
}

export function dashboardFromDesk(): {
  users: Array<{
    id: string;
    email: string | null;
    signedUpAt: string;
    role: string;
  }>;
  collected: Array<{
    id: string;
    userId: string;
    userEmail: string | null;
    amountUsd: number | null;
    amountKes: number | null;
    status: string;
    provider: string | null;
    payment: string;
    receipt: string | null;
    createdAt: string;
    creditedAt: string | null;
  }>;
  other: Array<{
    id: string;
    userId: string;
    userEmail: string | null;
    amountUsd: number | null;
    amountKes: number | null;
    status: string;
    provider: string | null;
    payment: string;
    receipt: string | null;
    createdAt: string;
    creditedAt: string | null;
  }>;
  totals: {
    collectedUsd: number;
    collectedKes: number;
    collectedCount: number;
    userCount: number;
  };
} {
  const desk = loadAdminDesk();
  const collected = desk.realPayments.map((row) => ({
    id: row.id,
    userId: row.email,
    userEmail: row.email,
    amountUsd: row.usd,
    amountKes: row.kes,
    status: "COMPLETED",
    provider: "M-Pesa",
    payment: row.payment,
    receipt: row.reference === "—" ? null : row.reference,
    createdAt: row.createdAt,
    creditedAt: row.createdAt,
  }));
  const collectedUsd =
    Math.round(
      collected.reduce((sum, row) => sum + (row.amountUsd ?? 0), 0) * 100,
    ) / 100;
  const collectedKes = collected.reduce(
    (sum, row) => sum + (row.amountKes ?? 0),
    0,
  );
  return {
    users: desk.users.map((user) => ({
      id: user.email,
      email: user.email,
      signedUpAt: user.createdAt,
      role: user.role,
    })),
    collected,
    other: [],
    totals: {
      collectedUsd,
      collectedKes,
      collectedCount: collected.length,
      userCount: desk.users.length,
    },
  };
}
