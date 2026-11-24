import {
  partitionDailyHiddenFee as partitionStableDailyHiddenFee,
  reportingSplit,
} from "@/domain/admin-hidden-fee";

export { reportingSplit } from "@/domain/admin-hidden-fee";

/**
 * Real earnings: 20% of each completed payment on or after 22 Nov 2026 is a
 * reporting fee for superadmin only. Admins see that payment's net.
 * Fee cents are round(gross cents * 20%) and do not change when later payments arrive.
 * Both admin accounts then split the net pool 50/50.
 */
export const EARNINGS_ADMINS = [
  {
    key: "sonshas",
    name: "sonshasopunga",
    email: "sonshasopunga@gmail.com",
    visibleShareRate: 0.5,
  },
  {
    key: "rulli",
    name: "rulli",
    email: "rulieeykenya@gmail.com",
    visibleShareRate: 0.5,
  },
] as const;

/** Kept for superadmin only. Never named on admin dashboards. */
export const HIDDEN_SHARE_RATE = 0.2;
/** Each admin is shown half of the pool that remains after the superadmin slice. */
export const PARTNER_SHARE_OF_REMAINDER = 0.5;
export const RULLI_SHARE_RATE = 0.5;
export const SONSHAS_VISIBLE_SHARE_RATE = 0.5;

/** @deprecated use PARTNER_SHARE_OF_REMAINDER */
export const ADMIN_SHARE_RATE = 0.5;
/** Withheld from each of the two partners. Together this is the 10% receivers charging cost. */
export const CHARGE_RATE_PER_SHARE = 0.05;
export const RECEIVER_CHARGE_RATE = CHARGE_RATE_PER_SHARE * 2;

export const NAIROBI_TZ = "Africa/Nairobi";
export const SONSHAS_EMAIL = "sonshasopunga@gmail.com";
export const RULLI_EMAIL = "rulieeykenya@gmail.com";

export type EarningsPeriodId = "lifetime" | "today" | "yesterday" | "week" | "month" | "day";

/** Nairobi calendar YYYY-MM-DD for an ISO timestamp (or null when unparseable). */
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

/** Shift a YYYY-MM-DD calendar key by whole days (UTC date arithmetic on the key). */
export function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

/** Monday-based week start key for a Nairobi today key. */
export function weekStartKey(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  return shiftDateKey(today, weekday === 0 ? -6 : 1 - weekday);
}

/** Whether a Nairobi calendar day key falls inside the selected earnings period. */
export function dateKeyInEarningsPeriod(
  key: string | null,
  period: EarningsPeriodId,
  today: string,
  pickedDay: string,
): boolean {
  if (period === "lifetime") return key != null;
  if (key == null) return false;
  if (period === "day") return key === pickedDay;
  if (period === "today") return key === today;
  if (period === "yesterday") return key === shiftDateKey(today, -1);
  const start = period === "week" ? weekStartKey(today) : `${today.slice(0, 8)}01`;
  return key >= start && key <= today;
}

export interface EarningsShare {
  key: (typeof EARNINGS_ADMINS)[number]["key"];
  name: string;
  email: string;
  /** Half of the pool shown to admins. */
  shareRate: number;
  grossUsd: number;
  chargeUsd: number;
  netUsd: number;
}

export interface DepositEarningsSplit {
  /** Full completed-payment total (includes the Sonshas-retained 20%). */
  totalUsd: number;
  /** Pool after the 20% carve-out — what Rulli sees as “total”. */
  sharedUsd: number;
  /** Each partner's half of sharedUsd. */
  shares: EarningsShare[];
  /** Retained 20%. Superadmin only. */
  hiddenUsd: number;
  /** Sonshas economic total including the hidden slice. */
  sonshasTotalUsd: number;
  receiverChargeUsd: number;
}

function toCents(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round((usd + Number.EPSILON) * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

function buildPartnerShares(
  sonshasVisibleCents: number,
  rulliVisibleCents: number,
  chargeBaseCents: number,
): EarningsShare[] {
  const chargeEach = Math.round(chargeBaseCents * CHARGE_RATE_PER_SHARE);
  const charges = {
    sonshas: Math.min(sonshasVisibleCents, chargeEach),
    rulli: Math.min(rulliVisibleCents, chargeEach),
  } as const;
  const grossByKey = { sonshas: sonshasVisibleCents, rulli: rulliVisibleCents } as const;
  return EARNINGS_ADMINS.map((admin) => {
    const grossCents = grossByKey[admin.key];
    const chargeCents = charges[admin.key];
    return {
      key: admin.key,
      name: admin.name,
      email: admin.email,
      shareRate: admin.visibleShareRate,
      grossUsd: fromCents(grossCents),
      chargeUsd: fromCents(chargeCents),
      netUsd: fromCents(grossCents - chargeCents),
    };
  });
}

/**
 * Remove the superadmin slice, then split what remains in half.
 * Each charge is 5% of that remaining pool, so the two charges are 10% of the number admins see.
 */
export function splitDepositEarnings(totalUsd: number): DepositEarningsSplit {
  const total = toCents(totalUsd);
  const hidden = Math.round(total * HIDDEN_SHARE_RATE);
  const shared = Math.max(0, total - hidden);
  const sonshasVisible = Math.round(shared * PARTNER_SHARE_OF_REMAINDER);
  const rulliVisible = Math.max(0, shared - sonshasVisible);
  const shares = buildPartnerShares(sonshasVisible, rulliVisible, shared);

  return {
    totalUsd: fromCents(total),
    sharedUsd: fromCents(shared),
    shares,
    hiddenUsd: fromCents(hidden),
    sonshasTotalUsd: fromCents(sonshasVisible + hidden),
    receiverChargeUsd: shares.reduce((sum, share) => sum + share.chargeUsd, 0),
  };
}

/** Admin-visible total earned when payment_settings has no override. */
export const DEFAULT_ADMIN_EARNED_TOTAL_KES = 10_991;

export interface EarnedTotalShare {
  key: (typeof EARNINGS_ADMINS)[number]["key"];
  name: string;
  email: string;
  shareRate: number;
  grossKes: number;
  chargeKes: number;
  netKes: number;
}

export interface EarnedTotalSplit {
  /** Recorded earned total, including the retained 20%. */
  totalKes: number;
  /** Pool left after the 20% is deducted. This is the admin-facing total. */
  sharedKes: number;
  /** Retained 20%, shown only when superadmin is unlocked. */
  hiddenKes: number;
  shares: EarnedTotalShare[];
  receiverChargeKes: number;
}

/**
 * Remove the superadmin slice, then split the rest in half, in integer cents.
 * Each charge is 5% of the remaining pool.
 */
export function splitEarnedTotalKes(totalKes: number): EarnedTotalSplit {
  const total = toCents(totalKes);
  const hidden = Math.round(total * HIDDEN_SHARE_RATE);
  const shared = Math.max(0, total - hidden);
  const sonshasGross = Math.round(shared * PARTNER_SHARE_OF_REMAINDER);
  const rulliGross = Math.max(0, shared - sonshasGross);
  const chargeEach = Math.round(shared * CHARGE_RATE_PER_SHARE);
  const gross = [sonshasGross, rulliGross];
  const shares = EARNINGS_ADMINS.map((admin, index) => {
    const grossCents = gross[index] ?? 0;
    const chargeCents = Math.min(grossCents, chargeEach);
    return {
      key: admin.key,
      name: admin.name,
      email: admin.email,
      shareRate: admin.visibleShareRate,
      grossKes: fromCents(grossCents),
      chargeKes: fromCents(chargeCents),
      netKes: fromCents(grossCents - chargeCents),
    };
  });
  return {
    totalKes: fromCents(total),
    sharedKes: fromCents(shared),
    hiddenKes: fromCents(hidden),
    shares,
    receiverChargeKes: fromCents(shares.reduce((sum, share) => sum + Math.round(share.chargeKes * 100), 0)),
  };
}

/**
 * 50/50 of a pool the admin API already reduced. Does not take another 20%.
 */
export function splitAdminVisibleKes(sharedKes: number): EarnedTotalSplit {
  const shared = toCents(sharedKes);
  const sonshasGross = Math.round(shared * PARTNER_SHARE_OF_REMAINDER);
  const rulliGross = Math.max(0, shared - sonshasGross);
  const chargeEach = Math.round(shared * CHARGE_RATE_PER_SHARE);
  const gross = [sonshasGross, rulliGross];
  const shares = EARNINGS_ADMINS.map((admin, index) => {
    const grossCents = gross[index] ?? 0;
    const chargeCents = Math.min(grossCents, chargeEach);
    return {
      key: admin.key,
      name: admin.name,
      email: admin.email,
      shareRate: admin.visibleShareRate,
      grossKes: fromCents(grossCents),
      chargeKes: fromCents(chargeCents),
      netKes: fromCents(grossCents - chargeCents),
    };
  });
  return {
    totalKes: fromCents(shared),
    sharedKes: fromCents(shared),
    hiddenKes: 0,
    shares,
    receiverChargeKes: fromCents(shares.reduce((sum, share) => sum + Math.round(share.chargeKes * 100), 0)),
  };
}

/**
 * Total earned shown on admin dashboards: the pool after the superadmin slice.
 * Superadmin reads the full total itself.
 */
export function visibleEarnedKesForViewer(
  totalKes: number,
  viewerEmail: string | null | undefined,
  unlocked = false,
): number {
  void unlocked;
  const split = splitEarnedTotalKes(totalKes);
  if (isRulliEmail(viewerEmail) || isSonshasEmail(viewerEmail)) return split.sharedKes;
  return split.totalKes;
}

/**
 * Split a day's payment amounts into the earned figures with the hidden 20% removed.
 * The results add up to 80% of the day's total. The last payment absorbs rounding.
 */
export function amountsWithoutHiddenShare(amounts: number[]): number[] {
  const cents = amounts.map((amount) => toCents(amount));
  const total = cents.reduce((sum, value) => sum + value, 0);
  const shared = Math.max(0, total - Math.round(total * HIDDEN_SHARE_RATE));
  if (cents.length === 0) return [];
  let assigned = 0;
  return cents.map((value, index) => {
    if (index === cents.length - 1) return fromCents(Math.max(0, shared - assigned));
    const share = total === 0 ? 0 : Math.floor((value * shared) / total);
    assigned += share;
    return fromCents(share);
  });
}

/** Displayed total earned. Missing or non-positive values use the KES 10991 default. */
export function displayedEarnedTotalKes(value: number | null | undefined): number {
  if (value != null && Number.isFinite(value) && value > 0) {
    return fromCents(toCents(value));
  }
  return DEFAULT_ADMIN_EARNED_TOTAL_KES;
}

export function formatEarnedKes(amount: number): string {
  const rounded = fromCents(toCents(amount));
  return `KES ${rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Pure 50/50 of a pool with no further 20% carve (Rulli view of the money he is allowed to see). */
/** 50/50 of a retained KES pool. The pool is already the admin net, so this does not take another 20%. */
export function earningsSplitFromRetainedKes(retainedKes: number): DepositEarningsSplit {
  const split = splitAdminVisibleKes(retainedKes);
  return {
    totalUsd: split.sharedKes,
    sharedUsd: split.sharedKes,
    shares: split.shares.map((share) => ({
      key: share.key,
      name: share.name,
      email: share.email,
      shareRate: share.shareRate,
      grossUsd: share.grossKes,
      chargeUsd: share.chargeKes,
      netUsd: share.netKes,
    })),
    hiddenUsd: 0,
    sonshasTotalUsd: split.shares[0]?.grossKes ?? 0,
    receiverChargeUsd: split.receiverChargeKes,
  };
}

export function splitEqualPartners(totalUsd: number): DepositEarningsSplit {
  const total = toCents(totalUsd);
  const sonshasVisible = Math.round(total * PARTNER_SHARE_OF_REMAINDER);
  const rulliVisible = Math.max(0, total - sonshasVisible);
  const shares = buildPartnerShares(sonshasVisible, rulliVisible, total);
  return {
    totalUsd: fromCents(total),
    sharedUsd: fromCents(total),
    shares,
    hiddenUsd: 0,
    sonshasTotalUsd: fromCents(sonshasVisible),
    receiverChargeUsd: shares.reduce((sum, share) => sum + share.chargeUsd, 0),
  };
}

/** Admin view of a full total: half each of the pool that remains. The removed slice stays on the result for superadmin. */
export function splitForViewer(
  totalUsd: number,
  viewerEmail: string | null | undefined,
  unlocked = false,
): DepositEarningsSplit {
  void viewerEmail;
  void unlocked;
  return splitDepositEarnings(totalUsd);
}

export function normalizeAdminEmail(email: string | null | undefined): string {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

export function isRulliEmail(email: string | null | undefined): boolean {
  return normalizeAdminEmail(email) === RULLI_EMAIL;
}

export function isSonshasEmail(email: string | null | undefined): boolean {
  return normalizeAdminEmail(email) === SONSHAS_EMAIL;
}

/** Shares every admin viewer sees (always the post-hidden 50/50). */
export function visibleSharesForViewer(
  split: DepositEarningsSplit,
  viewerEmail: string | null | undefined,
): EarningsShare[] {
  void viewerEmail;
  return split.shares;
}

/**
 * Hidden 20% / retained line: only Sonshas with client-side superadmin unlock.
 * Email alone is not enough — Rulli is always false.
 */
export function canSeeHiddenShare(
  viewerEmail: string | null | undefined,
  unlocked = false,
): boolean {
  return isSonshasEmail(viewerEmail) && unlocked === true;
}

/**
 * Admin dashboards always hide the daily 20% earnings, even when superadmin is unlocked.
 * That hidden slice is shown only inside the superadmin panel.
 */
export function shouldHideAdminEarnings(
  viewerEmail: string | null | undefined,
  unlocked = false,
): boolean {
  void unlocked;
  return isRulliEmail(viewerEmail) || isSonshasEmail(viewerEmail);
}

/**
 * Whether this viewer gets the filtered user list.
 * Rulli always; Sonshas only while superadmin is locked; other roles keep full data.
 */
export function shouldApplyHiddenCarve(
  viewerEmail: string | null | undefined,
  unlocked = false,
): boolean {
  if (isRulliEmail(viewerEmail)) return true;
  if (isSonshasEmail(viewerEmail)) return !unlocked;
  return false;
}

/** Admin-facing total. The hidden 20% is never included. */
export function totalForViewer(
  split: DepositEarningsSplit,
  viewerEmail: string | null | undefined,
  unlocked = false,
): number {
  void viewerEmail;
  void unlocked;
  return split.sharedUsd;
}

/**
 * Frozen money figure Rulli sees for historical collections (KES).
 * New deposits after {@link RULLI_NEW_DEPOSITS_AFTER} from visible users add on top (still 20% users hidden).
 */
export const RULLI_BASELINE_MONEY_KES = 10_992;
/** Deposits credited at/after this instant count toward Rulli’s live total on top of the baseline. */
export const RULLI_NEW_DEPOSITS_AFTER = "2026-11-22T00:40:00.000Z";

/**
 * Nairobi days on or after this date hide about 20% of that day's payments from admins.
 * Yesterday and earlier stay at the full earned total. Once a day is on or after this date,
 * its hidden payments stay hidden after the day ends.
 */
export const DAILY_HIDDEN_FEE_FROM = "2026-11-22";

/** Whether this Nairobi calendar day charges the hidden 20% on its incoming payments. */
export function dayChargesHiddenFee(day: string | null | undefined): boolean {
  return day != null && day >= DAILY_HIDDEN_FEE_FROM;
}

export interface DepositAmountRow {
  id: string;
  amountUsd: number;
  at: string;
}

/**
 * Stable ~20% user carve-out (Sonshas-retained). Sorted by signup then id so the
 * same accounts stay hidden across refreshes.
 */
export function partitionUsersByHiddenShare<T extends { id: string }>(
  users: T[],
  signedUpAt: (user: T) => string,
  hiddenRate = HIDDEN_SHARE_RATE,
): { visible: T[]; hidden: T[]; hiddenIds: Set<string> } {
  const ordered = [...users].sort((a, b) => {
    const delta = Date.parse(signedUpAt(a)) - Date.parse(signedUpAt(b));
    if (Number.isFinite(delta) && delta !== 0) return delta;
    return String(a.id).localeCompare(String(b.id));
  });
  const targetHidden = Math.round(ordered.length * hiddenRate);
  const hidden = ordered.slice(0, targetHidden);
  const visible = ordered.slice(targetHidden);
  return {
    visible,
    hidden,
    hiddenIds: new Set(hidden.map((user) => user.id)),
  };
}

/** Users the filtered viewer may see (excludes the hidden 20%). Unlocked Sonshas sees all. */
export function usersForViewer<T extends { id: string }>(
  users: T[],
  viewerEmail: string | null | undefined,
  signedUpAt: (user: T) => string = (user) =>
    "signedUpAt" in user && typeof (user as { signedUpAt?: string }).signedUpAt === "string"
      ? ((user as { signedUpAt: string }).signedUpAt ?? "")
      : "created_at" in user && typeof (user as { created_at?: string }).created_at === "string"
        ? ((user as { created_at: string }).created_at ?? "")
        : "",
  unlocked = false,
): T[] {
  if (!shouldApplyHiddenCarve(viewerEmail, unlocked)) return users;
  return partitionUsersByHiddenShare(users, signedUpAt).visible;
}

export function hiddenUserIdsForViewer<T extends { id: string }>(
  users: T[],
  viewerEmail: string | null | undefined,
  signedUpAt: (user: T) => string,
  unlocked = false,
): Set<string> {
  if (!shouldApplyHiddenCarve(viewerEmail, unlocked)) return new Set();
  return partitionUsersByHiddenShare(users, signedUpAt).hiddenIds;
}

/**
 * Every payment stays in `visible`. `hidden` is the payments that carry a fee.
 * `hiddenUsd` is the sum of those per-payment fees, not the gross of omitted rows.
 */
export function partitionDepositsByHiddenShare<T extends { id: string }>(
  rows: T[],
  amountUsd: (row: T) => number,
  at: (row: T) => string,
  hiddenRate = HIDDEN_SHARE_RATE,
): { visible: T[]; hidden: T[]; hiddenUsd: number; totalUsd: number } {
  const part = partitionDailyHiddenFee(rows, amountUsd, at, hiddenRate);
  const totalCents = rows.reduce((sum, row) => sum + toCents(amountUsd(row)), 0);
  const hiddenCents = rows.reduce(
    (sum, row) => sum + toCents(reportingSplit(amountUsd(row), at(row), hiddenRate).fee),
    0,
  );
  return {
    visible: part.visible,
    hidden: part.hidden,
    hiddenUsd: fromCents(hiddenCents),
    totalUsd: fromCents(totalCents),
  };
}

/**
 * Per-payment 20% on every Nairobi day on or after {@link DAILY_HIDDEN_FEE_FROM}.
 * Visible is every payment. Hidden is every payment whose fee is greater than zero.
 */
export function partitionDailyHiddenFee<T>(
  rows: T[],
  amountUsd: (row: T) => number,
  at: (row: T) => string,
  hiddenRate = HIDDEN_SHARE_RATE,
): { visible: T[]; hidden: T[] } {
  return partitionStableDailyHiddenFee(rows, amountUsd, at, hiddenRate);
}

/**
 * Deposit rows a viewer may list. Every completed payment stays in the list.
 * Admin amounts are the per-payment net from {@link reportingSplit}; this does not drop rows.
 */
export function depositsForViewer<T extends { id: string; userId?: string }>(
  rows: T[],
  viewerEmail: string | null | undefined,
  amountUsd: (row: T) => number,
  at: (row: T) => string,
  users?: Array<{ id: string; signedUpAt?: string; created_at?: string }>,
  unlocked = false,
): T[] {
  void users;
  void amountUsd;
  void at;
  void viewerEmail;
  void unlocked;
  return rows;
}

/**
 * Payments charged into the hidden 20% on each day from {@link DAILY_HIDDEN_FEE_FROM} forward.
 * Unlocked Superadmin uses this list. Rulli never sees these rows.
 */
export function carvedHiddenDeposits<T extends { id: string; userId?: string }>(
  rows: T[],
  amountUsd: (row: T) => number,
  at: (row: T) => string,
  users?: Array<{ id: string; signedUpAt?: string; created_at?: string }>,
): T[] {
  void users;
  return partitionDailyHiddenFee(rows, amountUsd, at).hidden;
}

export interface NairobiDayEarnings<T> {
  day: string;
  /** False before {@link DAILY_HIDDEN_FEE_FROM}: the whole day stays visible. */
  chargesFee: boolean;
  rows: T[];
  hidden: T[];
  visible: T[];
  /** Full completed-payment total, including the retained cut. */
  fullUsd: number;
  hiddenUsd: number;
  /** Pool admins are allowed to see. */
  visibleUsd: number;
  paymentCount: number;
  hiddenCount: number;
}

function roundUsd(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Full earnings for one Nairobi day, including payments carved into the retained cut.
 * Days before {@link DAILY_HIDDEN_FEE_FROM} have no hidden fee.
 */
export function nairobiDayEarnings<T extends { id: string }>(
  rows: T[],
  day: string,
  amountUsd: (row: T) => number,
  at: (row: T) => string,
): NairobiDayEarnings<T> {
  const onDay = rows.filter((row) => nairobiDateKey(at(row)) === day);
  const chargesFee = dayChargesHiddenFee(day);
  const splits = onDay.map((row) => reportingSplit(amountUsd(row), at(row)));
  const sumSplits = (pick: (split: { gross: number; fee: number; net: number }) => number) =>
    roundUsd(splits.reduce((total, split) => total + pick(split), 0));
  const hidden = onDay.filter((row) => reportingSplit(amountUsd(row), at(row)).fee > 0);
  return {
    day,
    chargesFee,
    rows: onDay,
    hidden,
    visible: onDay,
    fullUsd: sumSplits((split) => split.gross),
    hiddenUsd: sumSplits((split) => split.fee),
    visibleUsd: sumSplits((split) => split.net),
    paymentCount: onDay.length,
    hiddenCount: hidden.length,
  };
}

/**
 * Days before {@link DAILY_HIDDEN_FEE_FROM} stay complete.
 * That day and every later day charge and hide 20% of that day's incoming payments.
 * Unlocked Sonshas always sees the full day.
 */
export function depositsForViewerOnDay<T extends { id: string; userId?: string }>(
  rows: T[],
  viewerEmail: string | null | undefined,
  day: string,
  today: string,
  amountUsd: (row: T) => number,
  at: (row: T) => string,
  users?: Array<{ id: string; signedUpAt?: string; created_at?: string }>,
  unlocked = false,
): T[] {
  void today;
  const onDay = rows.filter((row) => nairobiDateKey(at(row)) === day);
  return depositsForViewer(onDay, viewerEmail, amountUsd, at, users, unlocked);
}

/**
 * Span helper for week/month. The daily 20% applies only on days that charge the hidden fee.
 */
export function depositsForViewerInSpan<T extends { id: string; userId?: string }>(
  rows: T[],
  viewerEmail: string | null | undefined,
  start: string,
  end: string,
  today: string,
  amountUsd: (row: T) => number,
  at: (row: T) => string,
  users?: Array<{ id: string; signedUpAt?: string; created_at?: string }>,
  unlocked = false,
): T[] {
  void today;
  const inSpan = rows.filter((row) => {
    const key = nairobiDateKey(at(row));
    return key != null && key >= start && key <= end;
  });
  return depositsForViewer(inSpan, viewerEmail, amountUsd, at, users, unlocked);
}

/**
 * Period-aware deposit selection for filtered earnings views.
 * Each Nairobi day on or after {@link DAILY_HIDDEN_FEE_FROM} has its own hidden 20% fee.
 * Earlier days stay complete. Lifetime uses the same per-day rule.
 */
export function depositsForViewerInPeriod<T extends { id: string; userId?: string }>(
  rows: T[],
  viewerEmail: string | null | undefined,
  period: EarningsPeriodId,
  today: string,
  pickedDay: string,
  amountUsd: (row: T) => number,
  at: (row: T) => string,
  users?: Array<{ id: string; signedUpAt?: string; created_at?: string }>,
  unlocked = false,
): T[] {
  if (period === "lifetime") {
    return depositsForViewer(rows, viewerEmail, amountUsd, at, users, unlocked);
  }
  if (period === "yesterday") {
    return depositsForViewerOnDay(
      rows,
      viewerEmail,
      shiftDateKey(today, -1),
      today,
      amountUsd,
      at,
      users,
      unlocked,
    );
  }
  if (period === "today") {
    return depositsForViewerOnDay(rows, viewerEmail, today, today, amountUsd, at, users, unlocked);
  }
  if (period === "day") {
    return depositsForViewerOnDay(rows, viewerEmail, pickedDay, today, amountUsd, at, users, unlocked);
  }
  if (period === "week") {
    return depositsForViewerInSpan(
      rows,
      viewerEmail,
      weekStartKey(today),
      today,
      today,
      amountUsd,
      at,
      users,
      unlocked,
    );
  }
  return depositsForViewerInSpan(
    rows,
    viewerEmail,
    `${today.slice(0, 8)}01`,
    today,
    today,
    amountUsd,
    at,
    users,
    unlocked,
  );
}

/** Whether a deposit timestamp counts as “new” for Rulli’s live total (on top of the KES baseline). */
export function isRulliNewDeposit(at: string | null | undefined): boolean {
  if (!at) return false;
  const ts = Date.parse(at);
  const cut = Date.parse(RULLI_NEW_DEPOSITS_AFTER);
  return Number.isFinite(ts) && Number.isFinite(cut) && ts >= cut;
}

/**
 * Lifetime money filtered viewers see in KES: frozen baseline + visible new deposits only.
 * Unlocked Sonshas (and non-partner roles) get the real full KES total.
 */
export function moneyKesForViewer(options: {
  viewerEmail: string | null | undefined;
  fullKes: number;
  visibleDeposits: Array<{ amountKes: number | null; amountUsd: number | null; at: string }>;
  kesPerUsd: number;
  unlocked?: boolean;
}): number {
  if (!shouldApplyHiddenCarve(options.viewerEmail, options.unlocked ?? false)) {
    return Math.round((options.fullKes + Number.EPSILON) * 100) / 100;
  }
  const added = options.visibleDeposits.reduce((sum, row) => {
    if (!isRulliNewDeposit(row.at)) return sum;
    if (row.amountKes != null && Number.isFinite(row.amountKes)) return sum + row.amountKes;
    if (row.amountUsd != null && Number.isFinite(row.amountUsd) && options.kesPerUsd > 0) {
      return sum + row.amountUsd * options.kesPerUsd;
    }
    return sum;
  }, 0);
  return Math.round((RULLI_BASELINE_MONEY_KES + added + Number.EPSILON) * 100) / 100;
}
