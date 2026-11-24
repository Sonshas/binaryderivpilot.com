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
  /** Recorded once. Omitted from regular admin responses. */
  stored_gross_kes?: number | null;
  stored_fee_kes?: number | null;
  stored_net_kes?: number | null;
}

function finiteMoney(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Stored KES split when the three parts still add up. Otherwise null so the caller uses the formula. */
export function lockedKesSplit(row: SplitMoneyRow): ReportingSplit | null {
  const gross = finiteMoney(row.stored_gross_kes);
  const fee = finiteMoney(row.stored_fee_kes);
  const net = finiteMoney(row.stored_net_kes);
  if (gross == null || fee == null || net == null) return null;
  const grossCents = Math.round(gross * 100);
  const feeCents = Math.round(fee * 100);
  const netCents = Math.round(net * 100);
  if (feeCents < 0 || netCents < 0 || grossCents !== feeCents + netCents) return null;
  return { gross: grossCents / 100, fee: feeCents / 100, net: netCents / 100 };
}

export function kesReportingSplit(row: SplitMoneyRow): ReportingSplit | null {
  return lockedKesSplit(row) ?? (row.amount_kes == null ? null : reportingSplit(row.amount_kes, splitRowAt(row)));
}

function withoutStored<T extends SplitMoneyRow>(row: T): T {
  const copy = { ...row };
  delete copy.stored_gross_kes;
  delete copy.stored_fee_kes;
  delete copy.stored_net_kes;
  return copy;
}

export function splitRowAt(row: SplitMoneyRow): string {
  return row.credited_at ?? row.created_at ?? "";
}

/**
 * Deposit notes store the M-Pesa KES figure. Regular admin copy drops that figure
 * so the row reads as an ordinary receipt, without a second amount beside the net.
 */
export function neutralReceivedNote(note: string | null | undefined): string {
  const raw = (note ?? "").trim();
  if (!raw) return "M-Pesa deposit";
  const withoutAmount = raw
    .replace(/\bKES\s*[\d,]+(?:\.\d+)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([·•])/g, " $1")
    .replace(/([·•])\s+/g, "$1 ")
    .trim();
  const cleaned = withoutAmount.replace(/^[\s·•-]+|[\s·•-]+$/g, "").trim();
  return cleaned.length > 0 ? cleaned : "M-Pesa deposit";
}

/** Admin payload: amount fields are the net. Gross, fee, and the stored split are not copied onto the row. */
export function withNetAmounts<T extends SplitMoneyRow>(row: T): T {
  const at = splitRowAt(row);
  const kes = kesReportingSplit(row);
  const usd = row.amount_usd == null ? null : reportingSplit(row.amount_usd, at);
  return {
    ...withoutStored(row),
    amount_kes: kes == null ? null : kes.net,
    amount_usd: usd == null ? null : usd.net,
  };
}

/**
 * Regular-admin payment row. Amounts are the customer M-Pesa KES and the USD
 * credited to the wallet. Fee and net columns are not included.
 */
export function withCustomerPayment<T extends SplitMoneyRow>(row: T): T {
  const kes = kesReportingSplit(row);
  return {
    ...withoutStored(row),
    amount_kes: kes == null ? row.amount_kes : kes.gross,
    amount_usd: row.amount_usd,
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

/** Superadmin payload: gross stays in amount_*, and fee/net are explicit. Stored columns are not repeated. */
export function withExplicitSplit<T extends SplitMoneyRow>(row: T): T & AnnotatedSplitRow {
  const at = splitRowAt(row);
  const kes = kesReportingSplit(row);
  const usd = row.amount_usd == null ? null : reportingSplit(row.amount_usd, at);
  return {
    ...withoutStored(row),
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
