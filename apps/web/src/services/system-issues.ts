import {
  clearErrorLog,
  readErrorLog,
  recordAppError,
  removeErrorLogEntry,
  setErrorLogEscalator,
} from "@/lib/error-log";
import { demoAccountShort, realAccountShort } from "@/lib/branding";
import { safeUserMessage } from "@/lib/safe-user-message";
import { getSupabase } from "@/lib/supabase";

const FUNCTION = "system-issues";
const THROTTLE_MS = 60_000;
const lastSent = new Map<string, number>();

function sendRemoteIssue(
  area: string,
  operation: string,
  code: string | null,
  message: string,
): void {
  const client = getSupabase();
  if (!client) return;
  const route = typeof window === "undefined" ? null : window.location.pathname;
  void client.functions
    .invoke(FUNCTION, {
      method: "POST",
      body: {
        action: "report",
        area,
        operation,
        code,
        message: message.slice(0, 500),
        route,
      },
    })
    .catch(() => undefined);
}

/** Bridge window/console captures into system_issues (throttled). */
export function installErrorLogRemoteBridge(): void {
  setErrorLogEscalator((input) => {
    // Local Vite transform / a.log replay — not a production outage.
    if (input.area === "vite") return;
    const fingerprint = `${input.area}:${input.operation}:${input.code ?? ""}:${input.message.slice(0, 80)}`;
    const now = Date.now();
    if ((lastSent.get(fingerprint) ?? 0) > now - THROTTLE_MS) return;
    lastSent.set(fingerprint, now);
    sendRemoteIssue(
      input.area,
      input.operation,
      input.code ?? null,
      input.message,
    );
  });
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function describe(error: unknown): { code: string | null; message: string } {
  if (error && typeof error === "object") {
    const row = error as {
      code?: unknown;
      status?: unknown;
      message?: unknown;
      name?: unknown;
    };
    const code = row.code ?? row.status ?? null;
    const message =
      typeof row.message === "string" && row.message
        ? row.message
        : String(row.name ?? "Unknown error");
    return { code: code == null ? null : String(code), message };
  }
  return {
    code: null,
    message: typeof error === "string" && error ? error : "Unknown error",
  };
}

/** Client blips / feed reconnects — keep local log optional, do not open staff issues. */
export function isTransientBackendNoise(message: string): boolean {
  return /failed to send a request to the edge function|failed to fetch|networkerror when attempting to fetch|load failed|deriv websocket (closed|error)|deriv websocket not (connected|open)|deriv connection timeout|deriv unavailable|live price is unavailable|request idle timeout|rate limit|signal timed out|timeouterror|aborted|aborterror|window\.ethereum|selectedAddress/i.test(
    message,
  );
}

export function reportBackendIssue(
  area: string,
  operation: string,
  error: unknown,
  code?: string | number | null,
): void {
  const detail = describe(error);
  if (isTransientBackendNoise(detail.message)) return;
  const finalCode = code == null ? detail.code : String(code);
  const fingerprint = `${area}:${operation}:${finalCode ?? ""}`;
  const now = Date.now();
  if ((lastSent.get(fingerprint) ?? 0) > now - THROTTLE_MS) return;
  lastSent.set(fingerprint, now);
  recordAppError({
    area,
    operation,
    message: detail.message,
    code: finalCode,
    stack: error instanceof Error ? (error.stack ?? null) : null,
  });
  sendRemoteIssue(area, operation, finalCode, detail.message);
}

export async function edgeErrorMessage(
  error: unknown,
  fallback: string,
  where: { area: string; operation: string },
): Promise<string> {
  const context = (error as { context?: Response } | null)?.context;
  const status =
    context && typeof context.status === "number" ? context.status : null;
  let bodyMessage: string | null = null;
  if (context && typeof context.json === "function") {
    try {
      const body = (await context.clone().json()) as {
        error?: string;
        message?: string;
      };
      bodyMessage =
        body.error || body.message ? String(body.error ?? body.message) : null;
    } catch {}
  }
  if (status !== null && status >= 400 && status < 500 && bodyMessage) {
    return safeUserMessage(bodyMessage, fallback);
  }
  reportBackendIssue(
    where.area,
    where.operation,
    bodyMessage ? { message: bodyMessage } : error,
    status,
  );
  return fallback;
}

export interface SystemIssue {
  id: string;
  source: "web" | "edge" | "probe";
  area: string;
  operation: string;
  code: string | null;
  message: string;
  route: string | null;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string | null;
}

export interface TableProbe {
  table: string;
  ok: boolean;
  ms: number;
  code: string | null;
  message: string | null;
}

export interface SystemHealth {
  checkedAt: string;
  probes: TableProbe[];
  open: SystemIssue[];
  resolved: SystemIssue[];
  logAvailable: boolean;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function mapIssue(raw: Record<string, unknown>): SystemIssue {
  const source =
    raw.source === "edge" || raw.source === "probe" ? raw.source : "web";
  return {
    id: String(raw.id ?? ""),
    source,
    area: str(raw.area) ?? "unknown",
    operation: str(raw.operation) ?? "unknown",
    code: str(raw.code),
    message: str(raw.message) ?? "",
    route: str(raw.route),
    occurrences: Number(raw.occurrences ?? 1) || 1,
    firstSeen: str(raw.first_seen) ?? "",
    lastSeen: str(raw.last_seen) ?? "",
    resolvedAt: str(raw.resolved_at),
  };
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object",
      )
    : [];
}

async function adminError(error: unknown): Promise<string> {
  const context = (error as { context?: Response } | null)?.context;
  if (context?.status === 403)
    return "Admin access required to view system health.";
  if (context?.status === 401)
    return "Sign in as an admin to view system health.";
  return "System health could not be loaded. The issue log itself may be unavailable.";
}

function localHealth(): SystemHealth {
  const entries = readErrorLog();
  return {
    checkedAt: new Date().toISOString(),
    probes: [
      {
        table: "accounts",
        ok: true,
        ms: 0,
        code: null,
        message: "Local accounts are readable.",
      },
      {
        table: "demo_wallets",
        ok: true,
        ms: 0,
        code: null,
        message: `${demoAccountShort()} balances are stored per user.`,
      },
      {
        table: "real_wallets",
        ok: true,
        ms: 0,
        code: null,
        message: `${realAccountShort()} balances are stored per user.`,
      },
      {
        table: "error_log",
        ok: true,
        ms: 0,
        code: null,
        message: entries.length
          ? `${entries.length} logged error(s).`
          : "No logged errors.",
      },
    ],
    open: entries.map((entry) => ({
      id: entry.id,
      source: "web" as const,
      area: entry.area,
      operation: entry.operation,
      code: entry.code,
      message: entry.message,
      route: entry.route,
      occurrences: 1,
      firstSeen: entry.at,
      lastSeen: entry.at,
      resolvedAt: null,
    })),
    resolved: [],
    logAvailable: true,
  };
}

export const systemIssuesService = {
  async load(): Promise<Result<SystemHealth>> {
    const client = getSupabase();
    if (client) {
      const { data, error } = await client.functions.invoke<
        Record<string, unknown>
      >(FUNCTION, {
        method: "POST",
        body: { action: "overview" },
      });
      const status = (error as { context?: Response } | null)?.context?.status;
      if (status === 401 || status === 403)
        return { ok: false, error: await adminError(error) };
      if (!error && data) {
        return {
          ok: true,
          data: {
            checkedAt: str(data.checked_at) ?? new Date().toISOString(),
            probes: rows(data.probes).map((row) => ({
              table: String(row.table ?? ""),
              ok: row.ok === true,
              ms: Number(row.ms ?? 0) || 0,
              code: str(row.code),
              message: str(row.message),
            })),
            open: rows(data.open).map(mapIssue),
            resolved: rows(data.resolved).map(mapIssue),
            logAvailable: data.log_available !== false,
          },
        };
      }
    }
    return { ok: true, data: localHealth() };
  },

  async resolve(id?: string): Promise<Result<null>> {
    const client = getSupabase();
    if (client) {
      const { error } = await client.functions.invoke(FUNCTION, {
        method: "POST",
        body: id ? { action: "resolve", id } : { action: "resolve_all" },
      });
      const status = (error as { context?: Response } | null)?.context?.status;
      if (!error) return { ok: true, data: null };
      if (status === 401 || status === 403)
        return { ok: false, error: await adminError(error) };
    }
    if (id) removeErrorLogEntry(id);
    else clearErrorLog();
    return { ok: true, data: null };
  },
};
