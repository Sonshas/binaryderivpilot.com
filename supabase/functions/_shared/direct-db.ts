import postgres from "npm:postgres";

type Sql = ReturnType<typeof postgres>;

/**
 * One warm pool per isolate. Opening a new Postgres connection and then
 * waiting for `sql.end()` on every call was slower than the trade itself:
 * the entry tick aged out before insert, and settlement never finished.
 */
let pool: Sql | null = null;
let poolUrl = "";

// db.<ref>.supabase.co is IPv6-only from Edge. Use the IPv4 transaction pooler.
// Newer eu-west-1 projects land on aws-0; older ones used aws-1.
const POOLER_HOSTS = [
  (Deno.env.get("SUPABASE_POOLER_HOST") ?? "").trim(),
  // Prefer aws-0: aws-1 returns ENOTFOUND for this project's pooler tenant.
  "aws-0-eu-west-1.pooler.supabase.com",
  "aws-1-eu-west-1.pooler.supabase.com",
].filter(Boolean);

function rewriteToPooler(raw: string, host: string, port: number): string | null {
  const match = raw.match(
    /^(postgres(?:ql)?:\/\/)([^:@/]+)(?::([^@]*))?@db\.([a-z0-9]+)\.supabase\.co(?::\d+)?(\/.*)$/,
  );
  if (!match) return null;
  const [, scheme, user, password, ref, path] = match;
  const poolUser = user.includes(".") ? user : `${user}.${ref}`;
  const auth = password == null ? poolUser : `${poolUser}:${password}`;
  return `${scheme}${auth}@${host}:${port}${path}`;
}

function withPoolerPort(raw: string, port: number): string {
  return raw.replace(/(@[^/?]+)(?::\d+)?(?=\/|\?|$)/, (_match, host: string) => `${host}:${port}`);
}

function swapPoolerHost(raw: string, host: string): string {
  return raw.replace(/@[^/@?]+\.pooler\.supabase\.com/i, `@${host}`);
}

export function databaseUrlCandidates(): string[] {
  const raw = Deno.env.get("SUPABASE_DB_URL") ?? "";
  if (!raw) throw new Error("timeout");
  const out: string[] = [];
  const push = (url: string) => {
    if (url && !out.includes(url)) out.push(url);
  };
  // Transaction pooler (6543) first — session mode (5432) often drops Edge sockets.
  // Also rotate aws-0 / aws-1: one region pooler host often times out from Edge.
  if (/pooler\.supabase\.com/i.test(raw)) {
    const configuredHost = (raw.match(/@([^/@?]+\.pooler\.supabase\.com)/i) ?? [])[1] ?? "";
    const hosts = [
      configuredHost,
      ...POOLER_HOSTS,
      "aws-0-eu-west-1.pooler.supabase.com",
      "aws-1-eu-west-1.pooler.supabase.com",
    ].filter(Boolean);
    // Exact env URL first (whatever port/host Supabase issued).
    push(raw);
    push(withPoolerPort(raw, 6543));
    // Transaction pooler (6543) across hosts next — never burn a retry slot on
    // session-mode 5432 before the alternate region host has been tried.
    for (const host of hosts) {
      push(withPoolerPort(swapPoolerHost(raw, host), 6543));
    }
    for (const host of hosts) {
      push(withPoolerPort(swapPoolerHost(raw, host), 5432));
    }
    return out.length ? out : [raw];
  }
  for (const host of POOLER_HOSTS) {
    const rewritten = rewriteToPooler(raw, host, 6543);
    if (rewritten) push(rewritten);
  }
  for (const host of POOLER_HOSTS) {
    const rewritten = rewriteToPooler(raw, host, 5432);
    if (rewritten) push(rewritten);
  }
  return out.length ? out : [raw];
}

function databaseUrl(): string {
  return databaseUrlCandidates()[0]!;
}

function sqlOpts() {
  return {
    prepare: false,
    fetch_types: false,
    ssl: "require" as const,
    max: 1,
    connect_timeout: 2,
    idle_timeout: 0,
  };
}

/** A new client. Callers close it. Reusing one pooler socket drops the next query. */
export function openDirectSql(url = databaseUrl()): Sql {
  return postgres(url, sqlOpts());
}

function sharedSql(): Sql {
  const url = databaseUrl();
  if (!pool || poolUrl !== url) {
    poolUrl = url;
    pool = postgres(url, {
      ...sqlOpts(),
      max_lifetime: 60 * 30,
    });
  }
  return pool;
}

function isTimeout(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /timeout|timed out/i.test(message);
}

/** One statement on the warm pool. List reads skip BEGIN and set_config. */
export async function withDirectRead<T>(
  run: (sql: Sql) => Promise<T>,
  timeoutMs = 2500,
): Promise<T> {
  const sql = sharedSql();
  let timer: number | undefined;
  try {
    return await Promise.race([
      run(sql),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isClosedConnection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /connection_closed|connection closed|connection reset|econnreset|terminated unexpectedly|broken pipe|socket hang up|fetch failed|connect timeout|EAI_|ENOTFOUND|tenant\/user|Client has encountered/i
    .test(message);
}

/**
 * One read on a new IPv4 pooler connection, then close it.
 * Checking the shared pool back in drops the next admin date or page query.
 */
export async function withFreshDb<T>(
  run: (sql: Sql) => Promise<T>,
  timeoutMs = 8000,
): Promise<T> {
  const urls = databaseUrlCandidates();
  // Try the preferred pooler host, then one fallback — enough to survive
  // aws-0/aws-1 tenant routing without burning the whole request budget.
  const maxAttempts = Math.min(urls.length, 3);
  // Admin overview runs multiple selects; keep most of the caller budget per try.
  const perAttempt = Math.max(500, Math.floor(timeoutMs / maxAttempts));
  let last: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const sql = openDirectSql(urls[attempt]);
    let timer: number | undefined;
    const query = run(sql);
    try {
      const value = await Promise.race([
        query,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), perAttempt);
        }),
      ]);
      // Prefer a working URL for later shared-pool calls in this isolate.
      if (urls[attempt] && urls[attempt] !== poolUrl) {
        poolUrl = urls[attempt]!;
        pool = postgres(poolUrl, { ...sqlOpts(), max_lifetime: 60 * 30 });
      }
      return value;
    } catch (err) {
      last = err;
      query.catch(() => {
        /* the timed-out read is closed with the client */
      });
      if (!isClosedConnection(err) && !isTimeout(err) && attempt === maxAttempts - 1) {
        break;
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      try {
        await sql.end({ timeout: 1 });
      } catch {
        /* closed */
      }
    }
  }
  throw last instanceof Error ? last : new Error("failed");
}

/** Pool first, then a fresh connection. Used when the Data API is not answering. */
export async function runDirect<T>(
  run: (sql: Sql) => Promise<T>,
  timeoutMs = 5000,
): Promise<T> {
  // Keep the whole direct path inside the caller's budget. Cascading pooler
  // hosts used to burn 30–60s and trip edge IDLE_TIMEOUT / client aborts.
  const budget = Math.max(500, Math.min(timeoutMs, 8_000));
  try {
    return await withDirectDb(run, budget);
  } catch (first) {
    if (!isClosedConnection(first) && !isTimeout(first)) {
      /* still try a fresh socket; the shared pool may be stale */
    }
    return await withFreshDb(run, Math.min(budget, 3_000));
  }
}

export async function withDirectDb<T>(
  run: (sql: Sql) => Promise<T>,
  timeoutMs = 2500,
): Promise<T> {
  const budget = Math.max(500, Math.floor(timeoutMs));
  const sql = sharedSql();
  const ms = String(budget);
  let timer: number | undefined;
  const work = (async () => {
    try {
      return await sql.begin(async (tx) => {
        const bound = tx as Sql;
        if (typeof bound.json !== "function") bound.json = sql.json.bind(sql);
        await bound`select set_config('statement_timeout', ${ms}, true)`;
        return await run(bound);
      });
    } catch (err) {
      if (isTimeout(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (!/set_config|transaction/i.test(message)) throw err;
      return await run(sql);
    }
  })();
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), budget + 750);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    work.catch(() => {
      /* abandoned after outer race */
    });
  }
}
