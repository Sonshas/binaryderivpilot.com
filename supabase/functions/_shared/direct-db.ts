import net from "node:net";
import postgres from "npm:postgres";
import { freshAttemptPlan } from "./db-attempt-plan.ts";

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

/** Session mode (5432) keeps a backend for the life of the socket. That fills the 60-connection cap. */
function transactionPoolerUrls(): string[] {
  const urls = databaseUrlCandidates().filter((url) => /:6543(\/|\?|$)/.test(url));
  return urls.length ? urls : databaseUrlCandidates();
}

/**
 * Transaction pooler only. Session mode (5432) is one backend per socket and
 * is what filled the 60-connection cap; the dashboard's single attempt was
 * also stuck on that port until it timed out.
 */
function freshPoolerUrls(): string[] {
  const tx = transactionPoolerUrls().filter((url) => /:6543(\/|\?|$)/.test(url));
  return tx.length ? tx : transactionPoolerUrls();
}

function databaseUrl(): string {
  return transactionPoolerUrls()[0]!;
}

/**
 * Service-role Data API. The pooler from Edge often times out or closes on
 * the first write; PostgREST on this project answers the same rows directly.
 */
function serviceRestAuth(): { url: string; key: string } {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("rest unavailable");
  return { url, key };
}

export async function serviceRestGet(
  pathAndQuery: string,
  timeoutMs = 8_000,
): Promise<unknown> {
  const { url, key } = serviceRestAuth();
  const response = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`rest ${response.status} ${text.replace(/\s+/g, " ").slice(0, 100)}`);
  }
  return await response.json();
}

/** Service-role write through PostgREST. Prefer this over pooler opens from Edge. */
export async function serviceRestPost(
  table: string,
  body: Record<string, unknown>,
  options?: { prefer?: string; timeoutMs?: number },
): Promise<unknown> {
  const { url, key } = serviceRestAuth();
  const response = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: options?.prefer ?? "return=representation",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options?.timeoutMs ?? 6_000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`rest ${response.status} ${text.replace(/\s+/g, " ").slice(0, 100)}`);
  }
  if (response.status === 204) return null;
  return await response.json();
}

/** Edge DNS often tries IPv6 first and the connect timer fires before A is used. */
async function preferIpv4(host: string): Promise<string> {
  if (net.isIP(host)) return host;
  try {
    const lookup = (Deno as unknown as {
      resolveDns?: (name: string, type: "A") => Promise<string[]>;
    }).resolveDns;
    if (!lookup) return host;
    const records = await lookup(host, "A");
    if (records[0]) return records[0];
  } catch {
    /* keep the hostname */
  }
  return host;
}

/**
 * Plain TCP to the A record. postgres.js sends the SSLRequest and upgrades
 * this socket itself; handing it an already-TLS socket makes the pooler
 * close the connection on the first write.
 */
function directSocket(_options: { ssl?: unknown }, host: string, port: number) {
  return new Promise<net.Socket>((resolve, reject) => {
    let socket: net.Socket | undefined;
    const timer = setTimeout(() => {
      socket?.destroy();
      reject(new Error("connect timeout"));
    }, 4_000);
    const fail = (err: unknown) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error("connect failed"));
    };
    void (async () => {
      const address = await preferIpv4(host);
      socket = net.connect({ host: address, port });
      socket.once("error", fail);
      socket.once("connect", () => {
        clearTimeout(timer);
        socket?.off("error", fail);
        socket?.setNoDelay(true);
        if (socket) resolve(socket);
      });
    })().catch(fail);
  });
}

function sqlOpts() {
  return {
    prepare: false,
    fetch_types: false,
    ssl: "require" as const,
    max: 1,
    connect_timeout: 4,
    // Drop a warm socket that nobody is using so isolates cannot pin a backend.
    idle_timeout: 10,
    socket: directSocket,
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

/** Fresh socket only — no warm shared pool that can pin idle backends. */
export async function withDirectRead<T>(
  run: (sql: Sql) => Promise<T>,
  timeoutMs = 2500,
): Promise<T> {
  return await withFreshDb(run, Math.max(500, Math.floor(timeoutMs)));
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
  const urls = freshPoolerUrls();
  // One fallback host when the budget can cover two connects. Never slice
  // below connect_timeout or the read dies before Postgres accepts it.
  const plan = freshAttemptPlan(timeoutMs, urls.length);
  const notes: string[] = [];
  let last: unknown = null;
  for (let attempt = 0; attempt < plan.attempts; attempt++) {
    const sql = openDirectSql(urls[attempt]);
    let timer: number | undefined;
    const query = run(sql);
    try {
      const value = await Promise.race([
        query,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), plan.perAttemptMs);
        }),
      ]);
      // Do not keep a warm shared pool. Webhook floods used to leave one idle
      // postgres backend per Edge isolate and Auth could not open auth_admin.
      return value;
    } catch (err) {
      last = err;
      const port = (urls[attempt]?.match(/:(\d+)(?=\/|\?|$)/) ?? [])[1] ?? "?";
      const message = err instanceof Error ? err.message : "error";
      notes.push(`${port}:${message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[db]").slice(0, 80)}`);
      query.catch(() => {
        /* the timed-out read is closed with the client */
      });
      if (!isClosedConnection(err) && !isTimeout(err) && attempt === plan.attempts - 1) {
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
  const summary = notes.join(" | ");
  throw summary ? new Error(summary) : last instanceof Error ? last : new Error("failed");
}

/**
 * Always open → run → close. The old shared-pool BEGIN path left
 * "idle in transaction" backends after Edge timeouts, which filled the
 * 60-connection cap and took Auth + PostgREST + admin offline.
 */
export async function runDirect<T>(
  run: (sql: Sql) => Promise<T>,
  timeoutMs = 5000,
): Promise<T> {
  const budget = Math.max(500, Math.min(timeoutMs, 8_000));
  return await withFreshDb(run, budget);
}

/**
 * Same as runDirect: a fresh pooler socket that is always closed.
 * Callers that need multi-statement atomicity should BEGIN inside `run`;
 * sql.end() in withFreshDb aborts that transaction if the budget expires.
 */
export async function withDirectDb<T>(
  run: (sql: Sql) => Promise<T>,
  timeoutMs = 2500,
): Promise<T> {
  return await withFreshDb(run, Math.max(500, Math.floor(timeoutMs)));
}
