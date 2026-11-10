import { runDirect, serviceRestGet, serviceRestPost, withFreshDb } from "./direct-db.ts";

type Row = Record<string, unknown>;

function iso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return text || null;
}

function rowOut(row: Row, dates: string[]): Row {
  const next: Row = { ...row };
  for (const key of dates) {
    if (key in next) next[key] = iso(next[key]);
  }
  return next;
}

export async function readPaymentSettings(): Promise<Record<string, string>> {
  const rows = await runDirect(
    (sql) => sql<Row[]>`select key, value from public.payment_settings`,
    4000,
  );
  const map: Record<string, string> = {};
  for (const row of rows) {
    const key = String(row.key ?? "");
    if (key) map[key] = String(row.value ?? "");
  }
  return map;
}

/** null when the flag row is missing. */
export async function readFlag(key: string): Promise<boolean | null> {
  const rows = await runDirect(
    (sql) =>
      sql<Row[]>`select value from public.feature_flags where key = ${key} limit 1`,
    3000,
  );
  if (!rows[0]) return null;
  const value = rows[0].value;
  if (value === true || value === "true" || value === "t") return true;
  if (value === false || value === "false" || value === "f") return false;
  return null;
}

export async function readUserAccess(userId: string): Promise<{
  accountStatus: string;
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
  winRatePercent: number | null;
  isVip: boolean;
  withdrawGatesCleared: boolean;
} | null> {
  const rows = await runDirect(
    (sql) => sql<Row[]>`
      select account_status, deposits_enabled, withdrawals_enabled,
             win_rate_percent, is_vip, withdraw_gates_cleared
        from public.users
       where id = ${userId}::uuid
       limit 1
    `,
    3000,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    accountStatus: String(row.account_status ?? "active"),
    depositsEnabled: row.deposits_enabled !== false,
    withdrawalsEnabled: row.withdrawals_enabled !== false,
    winRatePercent: row.win_rate_percent == null ? null : Number(row.win_rate_percent),
    isVip: row.is_vip === true,
    withdrawGatesCleared: row.withdraw_gates_cleared === true,
  };
}

export async function readRealWallet(userId: string): Promise<Row | null> {
  const rows = await runDirect(
    (sql) => sql<Row[]>`
      select id, user_id, account_id, account_mode, currency, balance,
             available_balance, locked_balance, status, is_simulated,
             created_at, updated_at
        from public.wallets
       where user_id = ${userId}::uuid
         and account_mode = 'real'
         and is_simulated = false
       limit 1
    `,
    4000,
  );
  const row = rows[0];
  return row ? rowOut(row, ["created_at", "updated_at"]) : null;
}

export async function hasSettledTrade(userId: string): Promise<boolean> {
  const rows = await runDirect(
    (sql) => sql<Row[]>`
      select id from public.trades
       where user_id = ${userId}::uuid
         and account_mode = 'real'
         and is_simulated = false
         and status in ('won', 'lost')
       limit 1
    `,
    3000,
  );
  return rows.length > 0;
}

function restRows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error("rest shape");
  return value.filter((row) => row && typeof row === "object") as Row[];
}

const ACTIVITY_DATES = ["created_at", "updated_at", "processing_at", "completed_at", "failed_at"];

/** Signed-in user's money lists via the Data API. Throws if deposits cannot be read. */
export async function readActivityViaRest(userId: string): Promise<{
  wallet: Row | null;
  deposits: Row[];
  withdrawals: Row[];
  transactions: Row[];
}> {
  const id = encodeURIComponent(userId);
  const scope = `user_id=eq.${id}&account_mode=eq.real&is_simulated=eq.false`;
  const [wallets, deposits, withdrawals, transactions] = await Promise.all([
    serviceRestGet(
      `wallets?select=id,user_id,account_id,account_mode,currency,balance,available_balance,locked_balance,status,is_simulated,created_at,updated_at&${scope}&limit=1`,
    ).then(restRows),
    serviceRestGet(
      `deposits?select=id,user_id,account_id,account_mode,wallet_id,amount,currency,method,status,provider,details,is_simulated,created_at,updated_at&${scope}&order=created_at.desc&limit=100`,
    ).then(restRows),
    serviceRestGet(
      `withdrawals?select=id,user_id,account_id,account_mode,wallet_id,amount,currency,destination,status,is_simulated,created_at,updated_at,provider,reference,amount_kes,fee_kes,net_kes,msisdn,mpesa_receipt,failure_reason,processing_at,completed_at,failed_at&${scope}&order=created_at.desc&limit=100`,
    ).then(restRows),
    serviceRestGet(
      `transactions?select=id,user_id,account_id,account_mode,wallet_id,type,amount,currency,status,reference,note,is_simulated,created_at,updated_at&${scope}&order=created_at.desc&limit=100`,
    ).then(restRows),
  ]);
  return {
    wallet: wallets[0] ? rowOut(wallets[0], ACTIVITY_DATES) : null,
    deposits: deposits.map((row) => rowOut(row, ACTIVITY_DATES)),
    withdrawals: withdrawals.map((row) => rowOut(row, ACTIVITY_DATES)),
    transactions: transactions.map((row) => rowOut(row, ACTIVITY_DATES)),
  };
}

export async function readActivity(userId: string): Promise<{
  wallet: Row | null;
  deposits: Row[];
  withdrawals: Row[];
  transactions: Row[];
}> {
  return await withFreshDb(async (sql) => {
    const [wallets, deposits, withdrawals, transactions] = await Promise.all([
      sql<Row[]>`
        select id, user_id, account_id, account_mode, currency, balance,
               available_balance, locked_balance, status, is_simulated,
               created_at, updated_at
          from public.wallets
         where user_id = ${userId}::uuid
           and account_mode = 'real'
           and is_simulated = false
         limit 1
      `,
      sql<Row[]>`
        select id, user_id, account_id, account_mode, wallet_id, amount, currency,
               method, status, provider, details, is_simulated, created_at, updated_at
          from public.deposits
         where user_id = ${userId}::uuid
           and account_mode = 'real'
           and is_simulated = false
         order by created_at desc
         limit 100
      `,
      sql<Row[]>`
        select id, user_id, account_id, account_mode, wallet_id, amount, currency,
               destination, status, is_simulated, created_at, updated_at, provider,
               reference, amount_kes, fee_kes, net_kes, msisdn, mpesa_receipt,
               failure_reason, processing_at, completed_at, failed_at
          from public.withdrawals
         where user_id = ${userId}::uuid
           and account_mode = 'real'
           and is_simulated = false
         order by created_at desc
         limit 100
      `,
      sql<Row[]>`
        select id, user_id, account_id, account_mode, wallet_id, type, amount,
               currency, status, reference, note, is_simulated, created_at, updated_at
          from public.transactions
         where user_id = ${userId}::uuid
           and account_mode = 'real'
           and is_simulated = false
         order by created_at desc
         limit 100
      `,
    ]);
    const dates = ["created_at", "updated_at", "processing_at", "completed_at", "failed_at"];
    return {
      wallet: wallets[0] ? rowOut(wallets[0], dates) : null,
      deposits: deposits.map((row) => rowOut(row, dates)),
      withdrawals: withdrawals.map((row) => rowOut(row, dates)),
      transactions: transactions.map((row) => rowOut(row, dates)),
    };
  }, 8_000);
}

export async function saveMegapayCursor(accountId: string): Promise<void> {
  await runDirect(
    (sql) => sql`
      insert into public.payment_settings (key, value, description, updated_at)
      values (
        'MEGAPAY_RR_CURSOR',
        ${accountId},
        'Last MegaPay account used for round-robin STK (winsoft or vast).',
        now()
      )
      on conflict (key) do update
        set value = excluded.value, updated_at = now()
    `,
    3000,
  );
}

export async function insertPendingDeposit(input: {
  userId: string;
  accountId: string;
  walletId: string;
  amountUsd: number;
  currency: string;
  details: Record<string, unknown>;
}): Promise<Row> {
  const rows = await runDirect(
    (sql) => sql<Row[]>`
      insert into public.deposits (
        user_id, account_id, account_mode, wallet_id, amount, currency,
        method, status, provider, is_simulated, details
      ) values (
        ${input.userId}::uuid,
        ${input.accountId}::uuid,
        'real',
        ${input.walletId}::uuid,
        ${input.amountUsd},
        ${input.currency},
        'mpesa',
        'PENDING',
        'megapay',
        false,
        ${sql.json(input.details)}
      )
      returning id, user_id, amount, currency, status, provider, provider_reference, details, created_at
    `,
    5000,
  );
  const row = rows[0];
  if (!row) throw new Error("deposit_insert_empty");
  return rowOut(row, ["created_at"]);
}

export async function storeDepositRequestId(
  depositId: string,
  requestId: string,
  details: Record<string, unknown>,
): Promise<void> {
  await runDirect(
    (sql) => sql`
      update public.deposits
         set provider_reference = ${requestId},
             details = ${sql.json({ ...details, megapay_request_id: requestId })},
             updated_at = now()
       where id = ${depositId}::uuid
    `,
    4000,
  );
}

export async function callFailDeposit(
  id: string,
  status: string,
  kind: string,
  reason: string,
  raw: unknown,
): Promise<void> {
  await runDirect(
    (sql) => sql`
      select public.fail_megapay_deposit(
        ${id}::uuid, ${status}, ${kind}, ${reason}, ${sql.json(raw ?? {})}
      )
    `,
    5000,
  );
}

export async function callCreditDeposit(
  id: string,
  receipt: string,
  amountKes: number,
  raw: unknown,
): Promise<void> {
  await runDirect(
    (sql) => sql`
      select public.credit_megapay_deposit(
        ${id}::uuid, ${receipt}, ${amountKes}, ${sql.json(raw ?? {})}
      )
    `,
    6000,
  );
}

export type PlaceRealTradeArgs = {
  userId: string;
  symbol: string;
  contractType: string;
  contractOption: string;
  selectedDigit: number | null;
  barrier: number | null;
  stake: number;
  payoutRate: number;
  entryPrice: number;
  entryEpoch: number;
  pipSize: number;
  idempotencyKey: string;
  durationTicks?: number | null;
  durationMs?: number | null;
};

export async function callPlaceRealTrade(
  input: PlaceRealTradeArgs,
): Promise<{ trade_id?: string; already?: boolean } | null> {
  const digit = input.selectedDigit;
  const barrier = input.barrier;
  const parse = (rows: { result?: unknown }[]) => {
    const raw = rows[0]?.result;
    if (raw == null) return null;
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || typeof value !== "object") return null;
    return value as { trade_id?: string; already?: boolean };
  };
  // Place needs a longer budget than flag reads — wallet locks can be slow.
  if (input.durationTicks != null) {
    const rows = await runDirect(
      (sql) =>
        sql<{ result: unknown }[]>`
          select public.place_real_tick_trade(
            ${input.userId}::uuid,
            ${input.symbol},
            ${input.contractType},
            ${input.contractOption},
            ${digit}::smallint,
            ${barrier}::smallint,
            ${input.stake}::numeric,
            ${input.durationTicks}::smallint,
            ${input.payoutRate}::numeric,
            ${input.entryPrice}::numeric,
            ${input.entryEpoch}::bigint,
            ${input.pipSize}::numeric,
            ${input.idempotencyKey}
          ) as result
        `,
      8_000,
    );
    return parse(rows);
  }
  const rows = await runDirect(
    (sql) =>
      sql<{ result: unknown }[]>`
        select public.place_real_trade(
          ${input.userId}::uuid,
          ${input.symbol},
          ${input.contractType},
          ${input.contractOption},
          ${digit}::smallint,
          ${barrier}::smallint,
          ${input.stake}::numeric,
          ${input.durationMs}::integer,
          ${input.payoutRate}::numeric,
          ${input.entryPrice}::numeric,
          ${input.entryEpoch}::bigint,
          ${input.pipSize}::numeric,
          ${input.idempotencyKey}
        ) as result
      `,
    8_000,
  );
  return parse(rows);
}

export async function loadWithdrawalRow(id: string): Promise<Row | null> {
  const rows = await runDirect(
    (sql) => sql<Row[]>`
      select id, user_id, amount, currency, status, provider, amount_kes, fee_kes,
             net_kes, msisdn, reference, mpesa_receipt, conversation_id,
             originator_conversation_id, result_code, result_desc, failure_reason,
             processing_at, completed_at, failed_at, admin_user_id, admin_note,
             details, created_at, updated_at
        from public.withdrawals
       where id = ${id}::uuid
       limit 1
    `,
    4000,
  );
  return rows[0]
    ? rowOut(rows[0], ["processing_at", "completed_at", "failed_at", "created_at", "updated_at"])
    : null;
}

export async function setDepositProviderReference(id: string, reference: string): Promise<void> {
  await runDirect(
    (sql) => sql`
      update public.deposits
         set provider_reference = ${reference}, updated_at = now()
       where id = ${id}::uuid
         and provider_reference is null
    `,
    4000,
  );
}

export async function markWebhookProcessed(id: string, result: string): Promise<void> {
  await runDirect(
    (sql) => sql`
      update public.megapay_webhook_events
         set processed = true, process_result = ${result}
       where id = ${id}::uuid
    `,
    4000,
  );
}

export async function callRequestWithdrawal(input: {
  userId: string;
  amountUsd: number;
  msisdn: string;
  kesPerUsd: number;
  feeKes: number;
  minKes: number;
  maxKes: number;
  provider: string;
  reference: string;
}): Promise<Row> {
  const rows = await runDirect(
    (sql) => sql<Row[]>`
      select public.request_real_withdrawal(
        ${input.userId}::uuid,
        ${input.amountUsd},
        ${input.msisdn},
        ${input.kesPerUsd},
        ${input.feeKes},
        ${input.minKes},
        ${input.maxKes},
        ${input.provider},
        ${input.reference}
      ) as result
    `,
    6000,
  );
  const result = rows[0]?.result;
  if (!result || typeof result !== "object") throw new Error("withdrawal_empty");
  return result as Row;
}

export async function loadDepositDirect(id: string): Promise<Row | null> {
  const rows = await runDirect(
    (sql) => sql<Row[]>`
      select id, user_id, amount, currency, status, provider, provider_reference, details, created_at
        from public.deposits
       where id = ${id}::uuid
       limit 1
    `,
    4000,
  );
  return rows[0] ? rowOut(rows[0], ["created_at"]) : null;
}

export async function findMegapayDeposit(input: {
  transactionId: string | null;
  reference: string | null;
}): Promise<Row | null> {
  // Data API only during webhook storms — never open a pooler socket here.
  if (input.transactionId) {
    const rows = await serviceRestGet(
      `deposits?select=id,user_id,amount,currency,status,provider,provider_reference,details,created_at&provider=eq.megapay&provider_reference=eq.${encodeURIComponent(input.transactionId)}&limit=1`,
    );
    if (Array.isArray(rows) && rows[0]) return rowOut(rows[0] as Row, ["created_at"]);
  }
  if (input.reference) {
    const rows = await serviceRestGet(
      `deposits?select=id,user_id,amount,currency,status,provider,provider_reference,details,created_at&provider=eq.megapay&details->>reference=eq.${encodeURIComponent(input.reference)}&limit=1`,
    );
    if (Array.isArray(rows) && rows[0]) return rowOut(rows[0] as Row, ["created_at"]);
  }
  return null;
}

export async function insertWebhookEvent(input: {
  payload: Record<string, unknown> | null;
  rawBody: string;
  contentType: string | null;
  reference: string | null;
  transactionId: string | null;
  routedTo: string;
  attempts: number;
  lastAttemptAt: string | null;
  processed: boolean;
  processResult: string | null;
}): Promise<string | null> {
  // PostgREST only. A pooler fallback per MegaPay callback refilled the
  // connection cap and kept auth_admin at 0 so password login stayed broken.
  const rows = await serviceRestPost(
    "megapay_webhook_events",
    {
      payload: input.payload,
      raw_body: input.rawBody,
      content_type: input.contentType,
      reference: input.reference,
      transaction_id: input.transactionId,
      routed_to: input.routedTo,
      attempts: input.attempts,
      last_attempt_at: input.lastAttemptAt,
      processed: input.processed,
      process_result: input.processResult,
    },
    { prefer: "return=representation", timeoutMs: 4_000 },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  const id = row && typeof row === "object" ? (row as Row).id : null;
  return id == null ? null : String(id);
}
