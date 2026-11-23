import { nairobiDateKey, shiftDateKey, weekStartKey } from "@/domain/admin-earnings";

export type UserPeriodCounts = {
  yesterday: number;
  today: number;
  week: number;
  month: number;
  lifetime: number;
};

export function usersInSpan(
  rows: Array<{ signedUpAt: string }>,
  start: string,
  end: string,
): number {
  return rows.filter((row) => {
    const key = nairobiDateKey(row.signedUpAt);
    return key != null && key >= start && key <= end;
  }).length;
}

export function userPeriodBounds(today: string): {
  yesterday: string;
  weekStart: string;
  monthStart: string;
} {
  return {
    yesterday: shiftDateKey(today, -1),
    weekStart: weekStartKey(today),
    monthStart: `${today.slice(0, 8)}01`,
  };
}

/** Count signups from a user list. Wrong when the list is capped — prefer API totals. */
export function userPeriodCountsFromRows(
  rows: Array<{ signedUpAt: string }>,
  today: string,
): UserPeriodCounts {
  const { yesterday, weekStart, monthStart } = userPeriodBounds(today);
  return {
    yesterday: usersInSpan(rows, yesterday, yesterday),
    today: usersInSpan(rows, today, today),
    week: usersInSpan(rows, weekStart, today),
    month: usersInSpan(rows, monthStart, today),
    lifetime: rows.length,
  };
}

function finiteCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

/**
 * Prefer server COUNT(*) totals (Nairobi day/week/month/lifetime). Fall back to
 * counting the overview user list only when the API omitted a field.
 */
export function resolveUserPeriodCounts(
  rows: Array<{ signedUpAt: string }>,
  today: string,
  totals: Partial<UserPeriodCounts> | null | undefined,
): UserPeriodCounts {
  const fromList = userPeriodCountsFromRows(rows, today);
  return {
    yesterday: finiteCount(totals?.yesterday) ?? fromList.yesterday,
    today: finiteCount(totals?.today) ?? fromList.today,
    week: finiteCount(totals?.week) ?? fromList.week,
    month: finiteCount(totals?.month) ?? fromList.month,
    lifetime: finiteCount(totals?.lifetime) ?? fromList.lifetime,
  };
}
