import {
  REAL_ACCOUNT_ID,
  REAL_UNAVAILABLE_PAYMENTS,
  REAL_UNAVAILABLE_WITHDRAWALS,
  REAL_USER_ID,
  REAL_WALLET_ID,
} from "@/domain/account";
import { abortSignalAfter } from "@/lib/abort-timeout";
import { loadDemoSession } from "@/lib/demo-session";
import { nowIso } from "@/lib/ids";
import { loadRealBook, localBooksActive } from "@/lib/real-books";
import { reportBackendIssue } from "@/services/system-issues";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { REAL_INTEGRATION } from "@/providers/config";
import { notConnected, okReal } from "@/providers/results";
import type {
  AccountMode,
  Deposit,
  Transaction,
  TransactionStatus,
  TransactionType,
  Wallet,
  Withdrawal,
} from "@/types";
import type { WalletProvider } from "@/providers/wallet/demo-wallet-provider";
import { realAccountShort } from "@/lib/branding";

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function localRealEmail(): string {
  return loadDemoSession()?.email?.trim().toLowerCase() ?? "";
}

function transactionsFromLocal(email: string): Transaction[] {
  const book = loadRealBook(email);
  const userId = loadDemoSession()?.userId ?? REAL_USER_ID;
  return book.transactions.map((row) => ({
    id: row.id,
    userId,
    accountId: REAL_ACCOUNT_ID,
    accountMode: "real" as const,
    walletId: `wallet_real_${email}`,
    type: row.type,
    amount: row.amount,
    currency: "USD",
    status: row.status,
    reference: row.reference,
    note: row.note,
    isSimulated: false,
    createdAt: row.createdAt,
    updatedAt: row.createdAt,
  }));
}

function walletFromLocal(email: string): Wallet {
  const book = loadRealBook(email);
  const stamp = nowIso();
  const available = book.available;
  const locked = book.locked;
  return {
    id: `wallet_real_${email}`,
    userId: loadDemoSession()?.userId ?? REAL_USER_ID,
    accountId: REAL_ACCOUNT_ID,
    accountMode: "real",
    kind: "real",
    currency: "USD",
    balance: Math.round((available + locked) * 100) / 100,
    availableBalance: available,
    lockedBalance: locked,
    status: "ready",
    isSimulated: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function emptyRealWallet(overrides?: Partial<Wallet>): Wallet {
  const stamp = nowIso();
  return {
    id: REAL_WALLET_ID,
    userId: REAL_USER_ID,
    accountId: REAL_ACCOUNT_ID,
    accountMode: "real",
    kind: "real",
    currency: "USD",
    balance: null,
    availableBalance: null,
    lockedBalance: null,
    status: "not_connected",
    isSimulated: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

function mapWallet(row: {
  id: string;
  user_id: string;
  account_id: string;
  account_mode: string;
  currency: string;
  balance: number | string;
  available_balance: number | string;
  locked_balance: number | string;
  status: string;
  is_simulated: boolean;
  created_at: string;
  updated_at: string;
}): Wallet {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    accountMode: "real",
    kind: "real",
    currency: row.currency,
    balance: num(row.balance),
    availableBalance: num(row.available_balance),
    lockedBalance: num(row.locked_balance),
    status:
      row.status === "ready" || row.status === "empty"
        ? (row.status as "ready" | "empty")
        : "ready",
    isSimulated: Boolean(row.is_simulated),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const WALLET_READ_TIMEOUT_MS = 8000;

async function readRealWalletRow(
  client: NonNullable<ReturnType<typeof getSupabase>>,
  userId: string,
) {
  const query = () =>
    client
      .from("wallets")
      .select(
        "id, user_id, account_id, account_mode, currency, balance, available_balance, locked_balance, status, is_simulated, created_at, updated_at",
      )
      .eq("user_id", userId)
      .eq("account_mode", "real")
      .abortSignal(abortSignalAfter(WALLET_READ_TIMEOUT_MS))
      .maybeSingle();
  const first = await query();
  return first.error ? query() : first;
}

function mapTxStatus(status: string): TransactionStatus {
  const allowed: TransactionStatus[] = [
    "PENDING",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ];
  if ((allowed as string[]).includes(status))
    return status as TransactionStatus;
  return "PENDING";
}

function mapTxType(type: string): TransactionType {
  const allowed: TransactionType[] = [
    "deposit",
    "withdrawal",
    "trade_stake",
    "trade_payout",
    "trade_refund",
    "adjustment",
    "service_charge",
  ];
  if ((allowed as string[]).includes(type)) return type as TransactionType;
  return "adjustment";
}

export const realWalletProvider: WalletProvider = {
  id: "real-backend",

  async getBalance(kind: AccountMode) {
    return this.getWallet(kind);
  },

  async getWallet(_kind: AccountMode) {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected(
        emptyRealWallet(),
        `${realAccountShort()} wallet is temporarily unavailable. Please try again shortly.`,
        "NOT_CONNECTED",
      );
    }

    const client = getSupabase()!;
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user) {
      const email = localRealEmail();
      if (email)
        return okReal(
          walletFromLocal(email),
          `${realAccountShort()} wallet loaded.`,
        );
      return notConnected(
        emptyRealWallet(),
        `Sign in to load your ${realAccountShort()} wallet.`,
        "NOT_CONNECTED",
      );
    }

    const { data, error } = await readRealWalletRow(client, session.user.id);

    if (error) {
      reportBackendIssue("wallet", "wallets.read", error);
      return notConnected(
        emptyRealWallet(),
        `${realAccountShort()} wallet could not be loaded. Please try again later.`,
        "NOT_CONNECTED",
      );
    }
    if (!data) {
      return notConnected(
        emptyRealWallet({ userId: session.user.id, status: "empty" }),
        `${realAccountShort()} wallet is still being prepared. Please try again in a moment.`,
        "NOT_CONNECTED",
      );
    }
    if (data.is_simulated) {
      return notConnected(
        emptyRealWallet({ userId: session.user.id }),
        `${realAccountShort()} wallet is temporarily unavailable.`,
        "NOT_CONNECTED",
      );
    }

    const wallet = mapWallet(data);
    return okReal(wallet, `${realAccountShort()} wallet loaded.`);
  },

  async getWallets() {
    const result = await this.getWallet("real");
    return {
      ...result,
      data: [result.data],
    };
  },

  async getTransactions(_kind: AccountMode) {
    return this.listTransactions("real");
  },

  async listTransactions(_kind: AccountMode) {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected(
        [],
        `${realAccountShort()} activity is temporarily unavailable. Please try again shortly.`,
      );
    }
    const client = getSupabase()!;
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user) {
      const email = localRealEmail();
      if (email && localBooksActive())
        return okReal(
          transactionsFromLocal(email),
          `${realAccountShort()} transactions loaded.`,
        );
      return notConnected(
        [],
        `Sign in to load ${realAccountShort()} transactions.`,
      );
    }

    const { data, error } = await client
      .from("transactions")
      .select(
        "id, user_id, account_id, account_mode, wallet_id, type, amount, currency, status, reference, note, is_simulated, created_at, updated_at",
      )
      .eq("user_id", session.user.id)
      .eq("account_mode", "real")
      .eq("is_simulated", false)
      .order("created_at", { ascending: false });

    if (error) {
      reportBackendIssue("wallet", "transactions.read", error);
      return notConnected(
        [],
        `${realAccountShort()} transactions read failed. Please try again later.`,
      );
    }

    const rows: Transaction[] = (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      accountMode: "real" as const,
      walletId: row.wallet_id,
      type: mapTxType(row.type),
      amount: num(row.amount),
      currency: row.currency,
      status: mapTxStatus(row.status),
      reference: row.reference,
      note: row.note,
      isSimulated: false,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return okReal(
      rows,
      rows.length
        ? `${realAccountShort()} transactions loaded.`
        : `No ${realAccountShort()} transactions yet.`,
    );
  },

  async listDeposits() {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected(
        [],
        `${realAccountShort()} deposits are temporarily unavailable. Please try again shortly.`,
      );
    }
    const client = getSupabase()!;
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user) {
      return notConnected(
        [],
        `Sign in to load ${realAccountShort()} deposits.`,
      );
    }

    const { data, error } = await client
      .from("deposits")
      .select(
        "id, user_id, account_id, account_mode, wallet_id, amount, currency, method, status, provider, details, is_simulated, created_at, updated_at",
      )
      .eq("user_id", session.user.id)
      .eq("account_mode", "real")
      .eq("is_simulated", false)
      .order("created_at", { ascending: false });

    if (error) {
      reportBackendIssue("wallet", "deposits.read", error);
      return notConnected(
        [],
        `${realAccountShort()} deposits read failed. Please try again later.`,
      );
    }

    const rows: Deposit[] = (data ?? []).map((row) => {
      const details = (
        row.details &&
        typeof row.details === "object" &&
        !Array.isArray(row.details)
          ? row.details
          : {}
      ) as Record<string, unknown>;
      return {
        id: row.id,
        userId: row.user_id,
        accountId: row.account_id,
        accountMode: "real" as const,
        walletId: row.wallet_id,
        amount: num(row.amount),
        currency: row.currency,
        method: row.method,
        status: mapTxStatus(row.status),
        isSimulated: false,
        walletKind: "real" as const,
        provider: row.provider,
        reference:
          typeof details.reference === "string" ? details.reference : null,
        amountKes: details.amount_kes != null ? num(details.amount_kes) : null,
        failureReason:
          typeof details.failure_reason === "string"
            ? details.failure_reason
            : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    return okReal(
      rows,
      rows.length
        ? `${realAccountShort()} deposits loaded.`
        : `No ${realAccountShort()} deposits yet.`,
    );
  },

  async listWithdrawals() {
    if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
      return notConnected(
        [],
        `${realAccountShort()} withdrawals are temporarily unavailable. Please try again shortly.`,
      );
    }
    const client = getSupabase()!;
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user) {
      return notConnected(
        [],
        `Sign in to load ${realAccountShort()} withdrawals.`,
      );
    }

    const { data, error } = await client
      .from("withdrawals")
      .select(
        "id, user_id, account_id, account_mode, wallet_id, amount, currency, destination, status, is_simulated, created_at, updated_at, provider, reference, amount_kes, fee_kes, net_kes, msisdn, mpesa_receipt, failure_reason, processing_at, completed_at, failed_at",
      )
      .eq("user_id", session.user.id)
      .eq("account_mode", "real")
      .eq("is_simulated", false)
      .order("created_at", { ascending: false });

    if (error) {
      reportBackendIssue("wallet", "withdrawals.read", error);
      return notConnected(
        [],
        `${realAccountShort()} withdrawals read failed. Please try again later.`,
      );
    }

    const rows: Withdrawal[] = (data ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      accountMode: "real" as const,
      walletId: row.wallet_id,
      amount: num(row.amount),
      currency: row.currency,
      destination: row.destination,
      status: mapTxStatus(row.status),
      isSimulated: false,
      walletKind: "real" as const,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      provider: row.provider,
      reference: row.reference,
      amountKes: row.amount_kes == null ? null : num(row.amount_kes),
      feeKes: num(row.fee_kes),
      netKes: row.net_kes == null ? null : num(row.net_kes),
      msisdn: row.msisdn,
      receipt: row.mpesa_receipt,
      failureReason: row.failure_reason,
      processingAt: row.processing_at,
      completedAt: row.completed_at,
      failedAt: row.failed_at,
    }));

    return okReal(
      rows,
      rows.length
        ? `${realAccountShort()} withdrawals loaded.`
        : `No ${realAccountShort()} withdrawals yet.`,
    );
  },

  async createDeposit(input) {
    return this.requestDeposit(input);
  },

  async createWithdrawal(input) {
    return this.requestWithdrawal(input);
  },

  async requestDeposit(_input) {
    return notConnected(
      null,
      REAL_UNAVAILABLE_PAYMENTS,
      "REAL_PAYMENTS_UNAVAILABLE",
    );
  },

  async requestWithdrawal(_input) {
    return notConnected(
      null,
      REAL_UNAVAILABLE_WITHDRAWALS,
      "REAL_PAYMENTS_UNAVAILABLE",
    );
  },
};
