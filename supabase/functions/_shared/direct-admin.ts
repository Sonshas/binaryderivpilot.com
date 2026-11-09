import postgres from "npm:postgres@3.4.4";
import type { AuthUserSource, DepositSource, PublicUserSource } from "./admin-dashboard.ts";
import { withFreshDb } from "./direct-db.ts";

type Sql = ReturnType<typeof postgres>;

type SqlRow = Record<string, unknown>;

const USER_CAP = 5000;
const DEPOSIT_CAP = 10000;

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
  };
}

function dashboardDbUrl(): string {
  const raw = Deno.env.get("SUPABASE_DB_URL") ?? "";
  if (!raw) throw new Error("timeout");
  if (!/pooler\.supabase\.com/i.test(raw)) return raw;
  return raw.replace(/(@[^/?]+)(?::\d+)?(?=\/|\?|$)/, (_match, host: string) => {
    const bare = String(host).replace(/:\d+$/, "");
    return `${bare}:6543`;
  });
}

/**
 * Dashboard reads for /admin and /admin/earnings.
 * One sequential transaction-pooler connection. public.users supplies sign-up time.
 */
export async function loadAdminDashboardSources(): Promise<{
  authUsers: AuthUserSource[];
  profiles: PublicUserSource[];
  deposits: DepositSource[];
}> {
  const sql: Sql = postgres(dashboardDbUrl(), {
    prepare: false,
    fetch_types: false,
    ssl: "require",
    max: 1,
    connect_timeout: 8,
    idle_timeout: 0,
  });
  try {
    const profileRows = await sql<SqlRow[]>`
      select id::text as id, email, role, created_at
        from public.users
       order by created_at desc nulls last
       limit ${USER_CAP}
    `;
    const depositRows = await sql<SqlRow[]>`
      select id::text as id,
             user_id::text as user_id,
             amount,
             currency,
             status,
             provider,
             method,
             mpesa_receipt,
             callback_amount_kes,
             details,
             created_at,
             updated_at,
             is_simulated,
             account_mode
        from public.deposits
       where account_mode = 'real'
         and is_simulated = false
         and method = 'mpesa'
       order by created_at desc
       limit ${DEPOSIT_CAP}
    `;
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
    };
  } finally {
    try {
      await sql.end({ timeout: 1 });
    } catch {
      /* closed */
    }
  }
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

/** Compact users list for /admin/users — one SQL round trip. */
export async function loadAdminUserListRows(): Promise<AdminUserListSqlRow[]> {
  const rows = await withFreshDb(async (sql) => {
    return await sql<SqlRow[]>`
      with scoped_users as (
        select id, email, name, role, account_status, live_trading_enabled, deposits_enabled,
               withdrawals_enabled, win_rate_percent, kyc_status, created_at, suspended_at,
               withdraw_verification_enabled, withdraw_scanner_enabled, withdraw_tax_enabled,
               is_vip, withdraw_gates_cleared
          from public.users
         order by created_at desc nulls last, id asc
         limit ${USER_CAP}
      ),
      wallet_agg as (
        select user_id,
               coalesce(available_balance, 0)::float8 as available_usd,
               coalesce(locked_balance, 0)::float8 as locked_usd,
               coalesce(balance, 0)::float8 as balance_usd
          from public.wallets
         where account_mode = 'real'
           and is_simulated = false
           and user_id in (select id from scoped_users)
      ),
      profile_agg as (
        select user_id, coalesce(phone, '') as phone, coalesce(country, '') as country, display_name
          from public.profiles
         where user_id in (select id from scoped_users)
      ),
      deposit_agg as (
        select user_id,
               count(*) filter (
                 where status = 'COMPLETED'
               )::int as collected_count,
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
           and user_id in (select id from scoped_users)
         group by user_id
      ),
      withdraw_agg as (
        select user_id, count(*)::int as open_withdrawals
          from public.withdrawals
         where account_mode = 'real'
           and is_simulated = false
           and status in ('PENDING', 'PROCESSING')
           and user_id in (select id from scoped_users)
         group by user_id
      ),
      trade_agg as (
        select user_id, count(*)::int as trade_count
          from public.trades
         where account_mode = 'real'
           and is_simulated = false
           and user_id in (select id from scoped_users)
         group by user_id
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
             coalesce(w.balance_usd, 0) as balance_usd,
             coalesce(d.collected_usd, 0) as collected_usd,
             coalesce(d.collected_kes, 0) as collected_kes,
             coalesce(d.collected_count, 0) as collected_count,
             coalesce(x.open_withdrawals, 0) as open_withdrawals,
             coalesce(d.pending_deposits, 0) as pending_deposits,
             coalesce(t.trade_count, 0) as trade_count
        from scoped_users u
        left join wallet_agg w on w.user_id = u.id
        left join profile_agg p on p.user_id = u.id
        left join deposit_agg d on d.user_id = u.id
        left join withdraw_agg x on x.user_id = u.id
        left join trade_agg t on t.user_id = u.id
       order by u.created_at desc nulls last, u.id asc
    `;
  }, 15_000);

  return rows.map((row) => ({
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
    collected_usd: Math.round(money(row.collected_usd) * 100) / 100,
    collected_kes: Math.round(money(row.collected_kes) * 100) / 100,
    collected_count: Math.trunc(money(row.collected_count)),
    open_withdrawals: Math.trunc(money(row.open_withdrawals)),
    pending_deposits: Math.trunc(money(row.pending_deposits)),
    trade_count: Math.trunc(money(row.trade_count)),
  })).filter((row) => row.id);
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
