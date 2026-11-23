/**
 * Prefix-stable daily hidden fee.
 * Each Nairobi day on or after DAILY_HIDDEN_FEE_FROM walks payments in arrival
 * order and permanently hides a whole payment only when it fits in the
 * remaining 20% budget. Later payments never reclassify an earlier one.
 * Days before the start date stay fully visible.
 */
export const HIDDEN_SHARE_RATE = 0.2;
export const DAILY_HIDDEN_FEE_FROM = "2026-11-22";
export const NAIROBI_TZ = "Africa/Nairobi";

export function nairobiDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NAIROBI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function dayChargesHiddenFee(day: string | null | undefined): boolean {
  return day != null && day >= DAILY_HIDDEN_FEE_FROM;
}

function toCents(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round((amount + Number.EPSILON) * 100);
}

function rowId(row: unknown): string {
  if (row && typeof row === "object" && "id" in row) {
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string") return id;
    if (typeof id === "number") return String(id);
  }
  return "";
}

function byArrival<T>(at: (row: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const ta = Date.parse(at(a));
    const tb = Date.parse(at(b));
    const aOk = Number.isFinite(ta);
    const bOk = Number.isFinite(tb);
    if (aOk && bOk && ta !== tb) return ta - tb;
    if (aOk !== bOk) return aOk ? -1 : 1;
    return rowId(a).localeCompare(rowId(b));
  };
}

/**
 * Hide a payment only when its whole amount fits in the running 20% budget.
 * Visible payments stay at their real amount forever.
 */
function hiddenInArrivalOrder<T>(
  rows: T[],
  amount: (row: T) => number,
  at: (row: T) => string,
  hiddenRate: number,
): Set<T> {
  const hidden = new Set<T>();
  let total = 0;
  let hiddenCents = 0;
  for (const row of [...rows].sort(byArrival(at))) {
    const value = toCents(amount(row));
    const next = total + value;
    const budget = Math.round(next * hiddenRate) - hiddenCents;
    if (value > 0 && value <= budget) {
      hidden.add(row);
      hiddenCents += value;
    }
    total = next;
  }
  return hidden;
}

/**
 * Charge the hidden fee separately on every Nairobi day on or after
 * {@link DAILY_HIDDEN_FEE_FROM}. Earlier days stay whole.
 * Returned lists keep the input order.
 */
export function partitionDailyHiddenFee<T>(
  rows: T[],
  amount: (row: T) => number,
  at: (row: T) => string,
  hiddenRate = HIDDEN_SHARE_RATE,
): { visible: T[]; hidden: T[] } {
  const groups = new Map<string, T[]>();
  const exempt: T[] = [];
  for (const row of rows) {
    const key = nairobiDateKey(at(row));
    if (!dayChargesHiddenFee(key)) {
      exempt.push(row);
      continue;
    }
    const list = groups.get(key as string) ?? [];
    list.push(row);
    groups.set(key as string, list);
  }
  const hidden = new Set<T>();
  for (const dayRows of groups.values()) {
    for (const row of hiddenInArrivalOrder(dayRows, amount, at, hiddenRate)) hidden.add(row);
  }
  return {
    visible: rows.filter((row) => !hidden.has(row)),
    hidden: rows.filter((row) => hidden.has(row)),
  };
}
