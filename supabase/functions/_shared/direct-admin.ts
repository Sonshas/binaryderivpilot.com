import type { AuthUserSource, DepositSource, PublicUserSource } from "./admin-dashboard.ts";
import { serviceRestExactCount, serviceRestGet, withFreshDb } from "./direct-db.ts";

type SqlRow = Record<string, unknown>;

const USER_LIST_TIMEOUT_MS = 8_000;
const DEPOSIT_CAP = 3000;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return value == null ? "" : String(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true" || value === "t";
}

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapAuth(row: SqlRow): AuthUserSource {
  return {
    id: String(row.id ?? ""),
    email: textOrNull(row.email),
    created_at: iso(row.created_at),
    app_role: textOrNull(row.app_role ?? row.role),
  };
}

function mapProfile(row: SqlRow): PublicUserSource {
  return {
    id: String(row.id ?? ""),
    email: textOrNull(row.email),
    role: textOrNull(row.role),
  };
}

function nullableMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function storedMoney(row: SqlRow): Pick<DepositSource, "stored_gross_kes" | "stored_fee_kes" | "stored_net_kes"> {
  const embedded = row.deposit_reporting_splits;
  const split = (Array.isArray(embedded) ? embedded[0] : embedded) as SqlRow | null | undefined;
  const source = split && typeof split === "object" ? split : row;
  return {
    stored_gross_kes: nullableMoney(source.stored_gross_kes ?? source.gross_kes),
    stored_fee_kes: nullableMoney(source.stored_fee_kes ?? source.fee_kes),
    stored_net_kes: nullableMoney(source.stored_net_kes ?? source.net_kes),
  };
}

function mapDeposit(row: SqlRow): DepositSource {
  return {
    id: String(row.id ?? ""),
    user_id: String(row.user_id ?? ""),
    amount: (row.amount as number | string | null) ?? null,
    currency: textOrNull(row.currency),
    status: textOrNull(row.status),
    provider: textOrNull(row.provider),
    method: textOrNull(row.method),
    mpesa_receipt: textOrNull(row.mpesa_receipt),
    callback_amount_kes: (row.callback_amount_kes as number | string | null) ?? null,
    details: asRecord(row.details),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    is_simulated: isTrue(row.is_simulated),
    account_mode: textOrNull(row.account_mode),
    ...storedMoney(row),
  };
}

function rowsFromRest(value: unknown): SqlRow[] {
  if (!Array.isArray(value)) throw new Error("rest shape");
  return value.filter((row) => row && typeof row === "object") as SqlRow[];
}

export type UserPeriodCounts = {
  yesterday: number;
  today: number;
  week: number;
  month: number;
  lifetime: number;
};

function intCount(value: unknown): number {
  const n = Math.trunc(money(value));
  return n > 0 ? n : 0;
}

function userCountsFromRow(row: SqlRow | undefined): UserPeriodCounts {
  return {
    yesterday: intCount(row?.yesterday),
    today: intCount(row?.today),
    week: intCount(row?.week),
    month: intCount(row?.month),
    lifetime: intCount(row?.lifetime),
  };
}

function sourcesFromRows(
  depositRows: SqlRow[],
  profileRows: SqlRow[],
  userCounts: UserPeriodCounts,
) {
  const profiles = profileRows.map(mapProfile).filter((row) => row.id);
  const authUsers = profileRows.map((row) =>
    mapAuth({
      id: row.id,
      email: row.email,
      created_at: row.created_at,
      app_role: row.role,
    }),
  ).filter((row) => row.id);
  return {
    authUsers,
    profiles,
    deposits: depositRows.map(mapDeposit).filter((row) => row.id && row.user_id),
    userCounts,
  };
}

function nairobiDateKeyNow(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDayKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

function weekStartDayKey(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  return shiftDayKey(today, weekday === 0 ? -6 : 1 - weekday);
}

function createdAtRangeQuery(startDay: string, endExclusiveDay: string): string {
  const start = encodeURIComponent(`${startDay}T00:00:00+03:00`);
  const end = encodeURIComponent(`${endExclusiveDay}T00:00:00+03:00`);
  return `created_at=gte.${start}&created_at=lt.${end}`;
}

async function loadUserPeriodCountsRest(): Promise<UserPeriodCounts> {
  const today = nairobiDateKeyNow();
  const yesterday = shiftDayKey(today, -1);
  const tomorrow = shiftDayKey(today, 1);
  const weekStart = weekStartDayKey(today);
  const monthStart = `${today.slice(0, 8)}01`;
  const [lifetime, todayCount, yesterdayCount, week, month] = await Promise.all([
    serviceRestExactCount("users?select=id"),
    serviceRestExactCount(`users?select=id&${createdAtRangeQuery(today, tomorrow)}`),
    serviceRestExactCount(`users?select=id&${createdAtRangeQuery(yesterday, today)}`),
    serviceRestExactCount(`users?select=id&${createdAtRangeQuery(weekStart, tomorrow)}`),
    serviceRestExactCount(`users?select=id&${createdAtRangeQuery(monthStart, tomorrow)}`),
  ]);
  return { lifetime, today: todayCount, yesterday: yesterdayCount, week, month };
}

const OVERVIEW_USER_CAP = 100;

/** Data API overview. Throws when deposits cannot be read — never an empty stand-in. */
async function loadAdminDashboardSourcesRest() {
  // Short budget. Do not run this at the same time as a pooler open — that
  // race left both paths failing while login-phone (SQL alone) still worked.
  const restMs = 8_000;
  const [depositRows, profileRows, userCounts] = await Promise.all([
    serviceRestGet(
      `deposits?select=id,user_id,amount,currency,status,provider,method,mpesa_receipt,callback_amount_kes,details,created_at,updated_at,is_simulated,account_mode,deposit_reporting_splits(gross_kes,fee_kes,net_kes)&account_mode=eq.real&is_simulated=eq.false&method=ilike.mpesa&status=eq.COMPLETED&order=created_at.desc&limit=${DEPOSIT_CAP}`,
      restMs,
    ).then(rowsFromRest),
    serviceRestGet(
      `users?select=id,email,role,created_at&order=created_at.desc&limit=${OVERVIEW_USER_CAP}`,
      restMs,
    ).then(rowsFromRest),
    loadUserPeriodCountsRest().catch(() => userCountsFromRow(undefined)),
  ]);
  return sourcesFromRows(depositRows, profileRows, userCounts);
}

/** Same shape as login-phone: one fresh socket, two tiny selects. */
async function loadAdminDashboardSourcesSql() {
  // One socket for both reads — two withFreshDb opens doubled pooler pressure
  // under the /admin page stampede and timed out while login-phone still worked.
  return await withFreshDb(async (sql) => {
    const profileRows = await sql<SqlRow[]>`
      select id::text as id, email, role, created_at
        from public.users
       order by created_at desc nulls last
       limit ${OVERVIEW_USER_CAP}
    `;
    const depositRows = await sql<SqlRow[]>`
      select d.id::text as id,
             d.user_id::text as user_id,
             d.amount,
             d.currency,
             d.status,
             d.provider,
             d.method,
             d.mpesa_receipt,
             d.callback_amount_kes,
             jsonb_build_object(
               'amount_usd', d.details->>'amount_usd',
               'amount_kes', d.details->>'amount_kes',
               'kind', d.details->>'kind',
               'payment', d.details->>'payment',
               'mpesa_receipt', d.details->>'mpesa_receipt',
               'completed_at', d.details->>'completed_at'
             ) as details,
             d.created_at,
             d.updated_at,
             d.is_simulated,
             d.account_mode,
             s.gross_kes as stored_gross_kes,
             s.fee_kes as stored_fee_kes,
             s.net_kes as stored_net_kes
        from public.deposits d
        left join public.deposit_reporting_splits s on s.deposit_id = d.id
       where d.account_mode = 'real'
         and d.is_simulated = false
         and lower(d.method) = 'mpesa'
         and d.status = 'COMPLETED'
       order by d.created_at desc
       limit ${DEPOSIT_CAP}
    `;
    const countRows = await sql<SqlRow[]>`
      select count(*)::int as lifetime,
             count(*) filter (
               where (timezone('Africa/Nairobi', created_at))::date
                 = (timezone('Africa/Nairobi', now()))::date
             )::int as today,
             count(*) filter (
               where (timezone('Africa/Nairobi', created_at))::date
                 = (timezone('Africa/Nairobi', now()))::date - 1
             )::int as yesterday,
             count(*) filter (
               where (timezone('Africa/Nairobi', created_at))::date
                 >= date_trunc('week', timezone('Africa/Nairobi', now()))::date
                 and (timezone('Africa/Nairobi', created_at))::date
                 <= (timezone('Africa/Nairobi', now()))::date
             )::int as week,
             count(*) filter (
               where (timezone('Africa/Nairobi', created_at))::date
                 >= date_trunc('month', timezone('Africa/Nairobi', now()))::date
                 and (timezone('Africa/Nairobi', created_at))::date
                 <= (timezone('Africa/Nairobi', now()))::date
             )::int as month
        from public.users
    `;
    if (!profileRows.length && !depositRows.length) {
      throw new Error("empty overview");
    }
    return sourcesFromRows(depositRows, profileRows, userCountsFromRow(countRows[0]));
  }, 10_000);
}

/**
 * Dashboard reads for /admin and /admin/earnings.
 * Pooler first (same path as login-phone). REST only if that socket fails —
 * racing both starved the pool and returned 500 while phone login still worked.
 */
export async function loadAdminDashboardSources(): Promise<{
  authUsers: AuthUserSource[];
  profiles: PublicUserSource[];
  deposits: DepositSource[];
  userCounts: UserPeriodCounts;
}> {
  try {
    return await loadAdminDashboardSourcesSql();
  } catch (directErr) {
    console.error(
      "admin-dashboard.direct",
      directErr instanceof Error
        ? directErr.message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[db]").slice(0, 160)
        : "error",
    );
  }
  return await loadAdminDashboardSourcesRest();
}

export type AdminUserListSqlRow = {
  id: string;
  email: string | null;
  name: string | null;
  phone: string;
  country: string;
  role: string;
  account_status: string;
  live_trading_enabled: boolean;
  deposits_enabled: boolean;
  withdrawals_enabled: boolean;
  win_rate_percent: number | null;
  withdraw_verification_enabled: boolean | null;
  withdraw_scanner_enabled: boolean | null;
  withdraw_tax_enabled: boolean | null;
  is_vip: boolean;
  withdraw_gates_cleared: boolean;
  kyc_status: string;
  created_at: string;
  available_usd: number;
  locked_usd: number;
  balance_usd: number;
  collected_usd: number;
  collected_kes: number;
  collected_count: number;
  open_withdrawals: number;
  pending_deposits: number;
  trade_count: number;
};

/** Every account for /admin/users. Identity first; payment stats are best-effort. */
export async function loadAdminUserListRows(): Promise<AdminUserListSqlRow[]> {
  const rows = await withFreshDb(async (sql) => {
    return await sql<SqlRow[]>`
      with wallet_agg as (
        select user_id,
               coalesce(sum(available_balance), 0)::float8 as available_usd,
               coalesce(sum(locked_balance), 0)::float8 as locked_usd,
               coalesce(sum(balance), 0)::float8 as balance_usd
          from public.wallets
         where account_mode = 'real'
           and is_simulated = false
         group by user_id
      ),
      profile_agg as (
        select distinct on (user_id)
               user_id, coalesce(phone, '') as phone, coalesce(country, '') as country, display_name
          from public.profiles
         order by user_id
      )
      select u.id::text as id,
             u.email,
             coalesce(u.name, p.display_name) as name,
             coalesce(p.phone, '') as phone,
             coalesce(p.country, '') as country,
             coalesce(u.role, 'trader') as role,
             coalesce(u.account_status, 'active') as account_status,
             coalesce(u.live_trading_enabled, true) as live_trading_enabled,
             coalesce(u.deposits_enabled, true) as deposits_enabled,
             coalesce(u.withdrawals_enabled, true) as withdrawals_enabled,
             u.win_rate_percent,
             u.withdraw_verification_enabled,
             u.withdraw_scanner_enabled,
             u.withdraw_tax_enabled,
             coalesce(u.is_vip, false) as is_vip,
             coalesce(u.withdraw_gates_cleared, false) as withdraw_gates_cleared,
             coalesce(u.kyc_status, 'not_started') as kyc_status,
             u.created_at,
             coalesce(w.available_usd, 0) as available_usd,
             coalesce(w.locked_usd, 0) as locked_usd,
             coalesce(w.balance_usd, 0) as balance_usd
        from public.users u
        left join wallet_agg w on w.user_id = u.id
        left join profile_agg p on p.user_id = u.id
       order by u.created_at desc nulls last, u.id asc
    `;
  }, USER_LIST_TIMEOUT_MS);

  const stats = new Map<string, SqlRow>();
  try {
    const statRows = await withFreshDb(async (sql) => {
      return await sql<SqlRow[]>`
        with deposit_agg as (
          select user_id,
                 count(*) filter (where status = 'COMPLETED')::int as collected_count,
                 coalesce(sum(
                   case
                     when status = 'COMPLETED' and upper(coalesce(currency, '')) = 'USD'
                       then amount::float8
                     when status = 'COMPLETED'
                       then coalesce((details->>'amount_usd')::float8, 0)
                     else 0
                   end
                 ), 0)::float8 as collected_usd,
                 coalesce(sum(
                   case
                     when status = 'COMPLETED'
                       then coalesce(
                         callback_amount_kes::float8,
                         (details->>'amount_kes')::float8,
                         case when upper(coalesce(currency, '')) = 'KES' then amount::float8 else 0 end
                       )
                     else 0
                   end
                 ), 0)::float8 as collected_kes,
                 count(*) filter (
                   where status in ('PENDING', 'FAILED', 'PROCESSING')
                 )::int as pending_deposits
            from public.deposits
           where account_mode = 'real'
             and is_simulated = false
             and method = 'mpesa'
           group by user_id
        ),
        withdraw_agg as (
          select user_id, count(*)::int as open_withdrawals
            from public.withdrawals
           where account_mode = 'real'
             and is_simulated = false
             and status in ('PENDING', 'PROCESSING')
           group by user_id
        ),
        trade_agg as (
          select user_id, count(*)::int as trade_count
            from public.trades
           where account_mode = 'real'
             and is_simulated = false
           group by user_id
        )
        select coalesce(d.user_id, x.user_id, t.user_id)::text as user_id,
               coalesce(d.collected_usd, 0) as collected_usd,
               coalesce(d.collected_kes, 0) as collected_kes,
               coalesce(d.collected_count, 0) as collected_count,
               coalesce(d.pending_deposits, 0) as pending_deposits,
               coalesce(x.open_withdrawals, 0) as open_withdrawals,
               coalesce(t.trade_count, 0) as trade_count
          from deposit_agg d
          full join withdraw_agg x on x.user_id = d.user_id
          full join trade_agg t on t.user_id = coalesce(d.user_id, x.user_id)
      `;
    }, 5_000);
    for (const row of statRows) {
      const id = String(row.user_id ?? "");
      if (id) stats.set(id, row);
    }
  } catch (err) {
    console.error("admin-users.list.stats", err instanceof Error ? err.message : "error");
  }

  return rows.map((row) => {
    const extra = stats.get(String(row.id ?? ""));
    return {
    id: String(row.id ?? ""),
    email: textOrNull(row.email),
    name: textOrNull(row.name),
    phone: String(row.phone ?? ""),
    country: String(row.country ?? ""),
    role: textOrNull(row.role) ?? "trader",
    account_status: textOrNull(row.account_status) ?? "active",
    live_trading_enabled: row.live_trading_enabled !== false,
    deposits_enabled: row.deposits_enabled !== false,
    withdrawals_enabled: row.withdrawals_enabled !== false,
    win_rate_percent: row.win_rate_percent == null ? null : money(row.win_rate_percent),
    withdraw_verification_enabled:
      row.withdraw_verification_enabled == null ? null : row.withdraw_verification_enabled === true,
    withdraw_scanner_enabled:
      row.withdraw_scanner_enabled == null ? null : row.withdraw_scanner_enabled === true,
    withdraw_tax_enabled: row.withdraw_tax_enabled == null ? null : row.withdraw_tax_enabled === true,
    is_vip: row.is_vip === true,
    withdraw_gates_cleared: row.withdraw_gates_cleared === true,
    kyc_status: textOrNull(row.kyc_status) ?? "not_started",
    created_at: iso(row.created_at),
    available_usd: money(row.available_usd),
    locked_usd: money(row.locked_usd),
    balance_usd: money(row.balance_usd),
    collected_usd: Math.round(money(extra?.collected_usd) * 100) / 100,
    collected_kes: Math.round(money(extra?.collected_kes) * 100) / 100,
    collected_count: Math.trunc(money(extra?.collected_count)),
    open_withdrawals: Math.trunc(money(extra?.open_withdrawals)),
    pending_deposits: Math.trunc(money(extra?.pending_deposits)),
    trade_count: Math.trunc(money(extra?.trade_count)),
  };
  }).filter((row) => row.id);
}

/** Completed real deposits for /admin/deposits — reuse the proven dashboard queries. */
export async function loadAdminDepositsList(
  limit = 300,
): Promise<Array<DepositSource & { user_email: string | null }>> {
  const cap = Math.max(1, Math.min(1000, Math.trunc(limit) || 300));
  const { authUsers, deposits } = await loadAdminDashboardSources();
  const emails = new Map(authUsers.map((row) => [row.id, row.email]));
  return deposits
    .filter((row) => row.status === "COMPLETED")
    .slice(0, cap)
    .map((row) => ({
      ...row,
      user_email: emails.get(row.user_id) ?? null,
    }));
}

export async function loadMemberGateState(userId: string): Promise<{
  paid: Partial<Record<"verification" | "scanner" | "tax", string>>;
  place: "form" | "verification" | "scanner" | "tax" | null;
}> {
  try {
    return await withFreshDb(async (sql) => {
      const [depositRows, profileRows] = await Promise.all([
        sql<SqlRow[]>`
          select details, status
            from public.deposits
           where user_id = ${userId}::uuid
             and status = 'COMPLETED'
           order by created_at desc
           limit 200
        `,
        sql<SqlRow[]>`
          select withdraw_place
            from public.profiles
           where user_id = ${userId}::uuid
           limit 1
        `,
      ]);
      const paid: Partial<Record<"verification" | "scanner" | "tax", string>> = {};
      for (const row of depositRows) {
        const details = asRecord(row.details);
        if (!details) continue;
        const kind = String(details.kind ?? "");
        if (kind === "verification" || kind === "scanner" || kind === "tax") {
          paid[kind] = new Date().toISOString();
        }
      }
      const placeRaw = textOrNull(profileRows[0]?.withdraw_place);
      const place =
        placeRaw === "form" || placeRaw === "verification" || placeRaw === "scanner" || placeRaw === "tax"
          ? placeRaw
          : null;
      return { paid, place };
    }, 5_000);
  } catch (err) {
    console.error("platform-settings.gates", err instanceof Error ? err.message : "error");
    return { paid: {}, place: null };
  }
}
