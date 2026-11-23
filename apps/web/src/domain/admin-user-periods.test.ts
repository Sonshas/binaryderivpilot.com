import { describe, expect, it } from "vitest";
import { weekStartKey } from "@/domain/admin-earnings";
import {
  resolveUserPeriodCounts,
  userPeriodBounds,
  userPeriodCountsFromRows,
  usersInSpan,
} from "@/domain/admin-user-periods";
import dashboardFn from "../../../../supabase/functions/admin-dashboard/index.ts?raw";
import directAdmin from "../../../../supabase/functions/_shared/direct-admin.ts?raw";

function user(id: string, signedUpAt: string) {
  return { id, signedUpAt };
}

describe("user signup period counts", () => {
  const today = "2026-11-15";

  it("uses Nairobi calendar days for today, week, month, and lifetime", () => {
    const { yesterday, weekStart, monthStart } = userPeriodBounds(today);
    expect(yesterday).toBe("2026-11-14");
    expect(weekStart).toBe("2026-11-09");
    expect(weekStartKey(today)).toBe("2026-11-09");
    expect(monthStart).toBe("2026-11-01");

    const rows = [
      user("today-utc-evening", "2026-11-15T20:30:00.000Z"),
      user("today-after-midnight", "2026-11-14T21:05:00.000Z"),
      user("yesterday", "2026-11-14T15:00:00.000Z"),
      user("week-monday", "2026-11-09T00:30:00.000Z"),
      user("last-month", "2026-10-31T20:00:00.000Z"),
    ];
    const counts = userPeriodCountsFromRows(rows, today);
    expect(usersInSpan(rows, today, today)).toBe(2);
    expect(counts.today).toBe(2);
    expect(counts.yesterday).toBe(1);
    expect(counts.week).toBe(4);
    expect(counts.month).toBe(4);
    expect(counts.lifetime).toBe(5);
  });

  it("does not let a capped overview list hide the database totals", () => {
    const capped = Array.from({ length: 100 }, (_, i) =>
      user(`u${i}`, "2026-11-15T10:00:00.000Z"),
    );
    const fromList = userPeriodCountsFromRows(capped, today);
    expect(fromList.lifetime).toBe(100);
    expect(fromList.today).toBe(100);

    const resolved = resolveUserPeriodCounts(capped, today, {
      yesterday: 688,
      today: 42,
      week: 1984,
      month: 2459,
      lifetime: 2523,
    });
    expect(resolved).toEqual({
      yesterday: 688,
      today: 42,
      week: 1984,
      month: 2459,
      lifetime: 2523,
    });
  });

  it("falls back to list counts only when the API omits a field", () => {
    const rows = [user("a", "2026-11-15T08:00:00.000Z"), user("b", "2026-11-01T08:00:00.000Z")];
    expect(resolveUserPeriodCounts(rows, today, undefined).lifetime).toBe(2);
    expect(resolveUserPeriodCounts(rows, today, { today: 0 }).today).toBe(0);
    expect(resolveUserPeriodCounts(rows, today, { lifetime: Number.NaN }).lifetime).toBe(2);
  });
});

describe("admin overview user totals come from COUNT(*)", () => {
  it("does not publish the capped user list length as lifetime total", () => {
    expect(dashboardFn).toContain("user_count: userCounts.lifetime");
    expect(dashboardFn).toContain("users_today: userCounts.today");
    expect(dashboardFn).not.toContain("user_count: users.length");
    expect(directAdmin).toContain("count(*)::int as lifetime");
    expect(directAdmin).toContain("timezone('Africa/Nairobi', created_at)");
    expect(directAdmin).toContain("OVERVIEW_USER_CAP");
    expect(directAdmin).toContain("serviceRestExactCount");
  });
});
