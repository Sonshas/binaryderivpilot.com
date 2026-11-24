import { describe, expect, it } from "vitest";
import webFee from "./admin-hidden-fee.ts?raw";
import edgeFee from "../../../../supabase/functions/_shared/admin-hidden-fee.ts?raw";
import { neutralReceivedNote, withNetAmounts } from "@/domain/admin-hidden-fee";
import { usdToKes } from "@/domain/withdrawals";
import {
  canSeeHiddenShare,
  carvedHiddenDeposits,
  dateKeyInEarningsPeriod,
  depositsForViewer,
  depositsForViewerInPeriod,
  depositsForViewerInSpan,
  depositsForViewerOnDay,
  moneyKesForViewer,
  nairobiDateKey,
  nairobiDayEarnings,
  partitionUsersByHiddenShare,
  RULLI_BASELINE_MONEY_KES,
  shiftDateKey,
  shouldApplyHiddenCarve,
  shouldHideAdminEarnings,
  amountsWithoutHiddenShare,
  splitDepositEarnings,
  splitEarnedTotalKes,
  splitEqualPartners,
  reportingSplit,
  totalForViewer,
  visibleEarnedKesForViewer,
  usersForViewer,
  weekStartKey,
} from "@/domain/admin-earnings";

describe("splitDepositEarnings", () => {
  it("keeps the edge hidden-fee module identical to the web module", () => {
    expect(edgeFee).toBe(webFee);
  });

  it("shows admins half each of the pool after the superadmin slice", () => {
    const split = splitDepositEarnings(100);
    expect(split.totalUsd).toBe(100);
    expect(split.hiddenUsd).toBe(20);
    expect(split.sharedUsd).toBe(80);
    expect(split.shares.map((share) => share.grossUsd)).toEqual([40, 40]);
    expect(split.shares.map((share) => share.shareRate)).toEqual([0.5, 0.5]);
    expect(split.shares.map((share) => share.chargeUsd)).toEqual([4, 4]);
    expect(split.shares.map((share) => share.netUsd)).toEqual([36, 36]);
    expect(split.sonshasTotalUsd).toBe(60);
    expect(split.receiverChargeUsd).toBe(8);
    expect(split.shares[0]?.email).toBe("sonshasopunga@gmail.com");
    expect(split.shares[1]?.email).toBe("rulieeykenya@gmail.com");
  });

  it("nets every payment at 80% and keeps that net when a later payment arrives", () => {
    const day = [
      { id: "d1", userId: "u2", usd: 10, at: "2026-11-22T08:00:00.000Z" },
      { id: "d2", userId: "u3", usd: 10, at: "2026-11-22T09:00:00.000Z" },
      { id: "d3", userId: "u4", usd: 10, at: "2026-11-22T10:00:00.000Z" },
      { id: "d4", userId: "u5", usd: 70, at: "2026-11-22T11:00:00.000Z" },
    ];
    const nets = day.map((row) => reportingSplit(row.usd, row.at));
    expect(nets.map((split) => split.net)).toEqual([8, 8, 8, 56]);
    expect(nets.map((split) => split.fee)).toEqual([2, 2, 2, 14]);
    expect(nets.reduce((sum, split) => sum + split.net + split.fee, 0)).toBe(100);
    const withLater = [...day, { id: "d5", userId: "u2", usd: 10_000, at: "2026-11-22T12:00:00.000Z" }];
    expect(withLater.slice(0, 4).map((row) => reportingSplit(row.usd, row.at).net)).toEqual([8, 8, 8, 56]);
    expect(reportingSplit(10_000, "2026-11-22T12:00:00.000Z")).toEqual({ gross: 10_000, fee: 2_000, net: 8_000 });
    expect(reportingSplit(6_500, "2026-11-23T20:54:00.000Z")).toEqual({ gross: 6_500, fee: 1_300, net: 5_200 });
    expect(reportingSplit(1_600, "2026-11-24T03:11:16.832Z")).toEqual({ gross: 1_600, fee: 320, net: 1_280 });
    const usdOf1600 = reportingSplit(12.31, "2026-11-24T03:11:16.832Z");
    expect(usdOf1600).toEqual({ gross: 12.31, fee: 2.46, net: 9.85 });
    expect(usdToKes(usdOf1600.net, 130)).toBe(1_281);
    expect(usdToKes(usdOf1600.net, 130.15)).toBe(1_282);
    expect(neutralReceivedNote("M-Pesa deposit KES 1600 · UKO2342F49")).toBe("M-Pesa deposit · UKO2342F49");
    const nov23 = reportingSplit(67_900, "2026-11-23T12:00:00.000Z");
    expect(nov23).toEqual({ gross: 67_900, fee: 13_580, net: 54_320 });
    expect(reportingSplit(nov23.net, "2026-11-23T12:00:00.000Z").net).not.toBe(nov23.net);
    expect(nov23.net).toBe(54_320);
    expect(reportingSplit(6_500, "2026-11-21T20:54:00.000Z")).toEqual({ gross: 6_500, fee: 0, net: 6_500 });
    const shown = withNetAmounts({
      amount_kes: 6_500,
      amount_usd: null,
      credited_at: "2026-11-23T20:54:00.000Z",
      stored_gross_kes: 6_500,
      stored_fee_kes: 1_300,
      stored_net_kes: 5_200,
    });
    expect(shown.amount_kes).toBe(5_200);
    expect(shown).not.toHaveProperty("stored_gross_kes");
    expect(shown).not.toHaveProperty("stored_fee_kes");
    expect(shown).not.toHaveProperty("stored_net_kes");
    expect(shown).not.toHaveProperty("fee_kes");
    const visible = depositsForViewer(day, "rulieeykenya@gmail.com", (row) => row.usd, (row) => row.at);
    expect(visible.map((row) => row.id)).toEqual(["d1", "d2", "d3", "d4"]);
    const hidden = carvedHiddenDeposits(day, (row) => row.usd, (row) => row.at);
    expect(hidden.map((row) => row.id)).toEqual(["d1", "d2", "d3", "d4"]);
    const netSum = nets.reduce((sum, split) => sum + split.net, 0);
    const split = splitEqualPartners(netSum);
    expect(split.sharedUsd).toBe(80);
    expect(split.hiddenUsd).toBe(0);
    expect(split.shares.map((share) => share.grossUsd)).toEqual([40, 40]);
  });

  it("splits a Rulli-visible pool 50/50 with no further carve", () => {
    const split = splitEqualPartners(80);
    expect(split.hiddenUsd).toBe(0);
    expect(split.sharedUsd).toBe(80);
    expect(split.shares.map((share) => share.grossUsd)).toEqual([40, 40]);
  });

  it("keeps visible shares plus hidden aligned to the total", () => {
    const split = splitDepositEarnings(100.01);
    const visible = split.shares.reduce((sum, share) => sum + share.grossUsd, 0);
    expect(Math.round((visible + split.hiddenUsd) * 100)).toBe(10001);
    expect(split.shares.reduce((sum, share) => sum + share.chargeUsd, 0)).toBe(split.receiverChargeUsd);
  });

  it("returns zeros when nothing has been deposited", () => {
    const split = splitDepositEarnings(0);
    expect(split.receiverChargeUsd).toBe(0);
    expect(split.hiddenUsd).toBe(0);
    expect(split.sharedUsd).toBe(0);
    expect(split.shares.every((share) => share.grossUsd === 0 && share.netUsd === 0)).toBe(true);
  });

  it("always returns a share row for every configured admin", () => {
    const split = splitDepositEarnings(42.5);
    expect(split.shares).toHaveLength(2);
    expect(split.shares.map((share) => share.key)).toEqual(["sonshas", "rulli"]);
    expect(split.shares.every((share) => share.email.includes("@"))).toBe(true);
  });

  it("can allocate a pool with the hidden share removed", () => {
    const shown = amountsWithoutHiddenShare([50, 30, 20]);
    expect(shown.reduce((sum, amount) => sum + amount, 0)).toBe(80);
    expect(shown.every((amount) => amount > 0)).toBe(true);
    expect(amountsWithoutHiddenShare([10, 10, 80])).toEqual([8, 8, 64]);
    expect(amountsWithoutHiddenShare([])).toEqual([]);
  });

  it("shows the hidden 20% only to unlocked Sonshas", () => {
    const split = splitDepositEarnings(100);
    expect(canSeeHiddenShare("sonshasopunga@gmail.com")).toBe(false);
    expect(canSeeHiddenShare("sonshasopunga@gmail.com", false)).toBe(false);
    expect(canSeeHiddenShare("sonshasopunga@gmail.com", true)).toBe(true);
    expect(canSeeHiddenShare("rulieeykenya@gmail.com", true)).toBe(false);
    expect(totalForViewer(split, "sonshasopunga@gmail.com", true)).toBe(80);
    expect(totalForViewer(split, "sonshasopunga@gmail.com", false)).toBe(80);
    expect(totalForViewer(split, "rulieeykenya@gmail.com")).toBe(80);
  });

  it("shows both admins half of KES 10991 after the superadmin slice", () => {
    const split = splitEarnedTotalKes(10991);
    expect(split.totalKes).toBe(10991);
    expect(split.hiddenKes).toBe(2198.2);
    expect(split.sharedKes).toBe(8792.8);
    expect(split.shares.map((share) => share.grossKes)).toEqual([4396.4, 4396.4]);
    expect(split.shares.map((share) => share.shareRate)).toEqual([0.5, 0.5]);
    expect(split.shares.map((share) => share.chargeKes)).toEqual([439.64, 439.64]);
    const chargeCents = Math.round(split.receiverChargeKes * 100);
    expect(chargeCents).toBe(87928);
    const netCents = split.shares.reduce((sum, share) => sum + Math.round(share.netKes * 100), 0);
    expect(netCents + chargeCents).toBe(879_280);
    expect(visibleEarnedKesForViewer(10991, "rulieeykenya@gmail.com")).toBe(8792.8);
    expect(visibleEarnedKesForViewer(10991, "sonshasopunga@gmail.com", false)).toBe(8792.8);
    expect(visibleEarnedKesForViewer(10991, "sonshasopunga@gmail.com", true)).toBe(8792.8);
    expect(split.shares.map((share) => share.email)).toEqual([
      "sonshasopunga@gmail.com",
      "rulieeykenya@gmail.com",
    ]);
  });
});

describe("hidden user carve-out", () => {
  const users = [
    { id: "u1", signedUpAt: "2026-11-01T10:00:00.000Z" },
    { id: "u2", signedUpAt: "2026-11-02T10:00:00.000Z" },
    { id: "u3", signedUpAt: "2026-11-03T10:00:00.000Z" },
    { id: "u4", signedUpAt: "2026-11-04T10:00:00.000Z" },
    { id: "u5", signedUpAt: "2026-11-05T10:00:00.000Z" },
  ];
  const deposits = [
    { id: "a", userId: "u1", usd: 20, at: "2026-11-01T10:00:00.000Z" },
    { id: "b", userId: "u2", usd: 30, at: "2026-11-02T10:00:00.000Z" },
    { id: "c", userId: "u3", usd: 50, at: "2026-11-03T10:00:00.000Z" },
  ];

  it("hides about 20% of users", () => {
    const part = partitionUsersByHiddenShare(users, (user) => user.signedUpAt);
    expect(part.hidden).toHaveLength(1);
    expect(part.visible).toHaveLength(4);
    expect(part.hidden[0]?.id).toBe("u1");
  });

  it("hides each day's 20% from both admins, including when superadmin is unlocked", () => {
    const hidden = carvedHiddenDeposits(
      deposits,
      (row) => row.usd,
      (row) => row.at,
      users,
    );
    expect(hidden.map((row) => row.id)).toEqual([]);
    expect(
      depositsForViewer(
        deposits,
        "sonshasopunga@gmail.com",
        (row) => row.usd,
        (row) => row.at,
        users,
        true,
      ).map((row) => row.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("applies the carve to Rulli and locked Sonshas, not unlocked Sonshas", () => {
    expect(shouldApplyHiddenCarve("rulieeykenya@gmail.com")).toBe(true);
    expect(shouldApplyHiddenCarve("sonshasopunga@gmail.com", false)).toBe(true);
    expect(shouldApplyHiddenCarve("sonshasopunga@gmail.com", true)).toBe(false);
    expect(shouldHideAdminEarnings("sonshasopunga@gmail.com", true)).toBe(true);
    expect(shouldHideAdminEarnings("rulieeykenya@gmail.com", true)).toBe(true);

    expect(usersForViewer(users, "rulieeykenya@gmail.com", (u) => u.signedUpAt).map((u) => u.id)).toEqual([
      "u2",
      "u3",
      "u4",
      "u5",
    ]);
    expect(
      usersForViewer(users, "sonshasopunga@gmail.com", (u) => u.signedUpAt, false).map((u) => u.id),
    ).toEqual(["u2", "u3", "u4", "u5"]);
    expect(
      usersForViewer(users, "sonshasopunga@gmail.com", (u) => u.signedUpAt, true).map((u) => u.id),
    ).toEqual(["u1", "u2", "u3", "u4", "u5"]);

    const incoming = [
      { id: "d1", userId: "u2", usd: 10, at: "2026-11-22T08:00:00.000Z" },
      { id: "d2", userId: "u3", usd: 10, at: "2026-11-22T09:00:00.000Z" },
      { id: "d3", userId: "u4", usd: 10, at: "2026-11-22T10:00:00.000Z" },
      { id: "d4", userId: "u5", usd: 70, at: "2026-11-22T11:00:00.000Z" },
      { id: "n1", userId: "u2", usd: 10, at: "2026-11-23T08:00:00.000Z" },
      { id: "n2", userId: "u3", usd: 10, at: "2026-11-23T09:00:00.000Z" },
      { id: "n3", userId: "u4", usd: 80, at: "2026-11-23T10:00:00.000Z" },
    ];
    const forRulli = depositsForViewer(
      incoming,
      "rulieeykenya@gmail.com",
      (row) => row.usd,
      (row) => row.at,
      users,
    );
    const forLockedSonshas = depositsForViewer(
      incoming,
      "sonshasopunga@gmail.com",
      (row) => row.usd,
      (row) => row.at,
      users,
      false,
    );
    const forUnlockedSonshas = depositsForViewer(
      incoming,
      "sonshasopunga@gmail.com",
      (row) => row.usd,
      (row) => row.at,
      users,
      true,
    );
    expect(forRulli.map((row) => row.id)).toEqual(["d1", "d2", "d3", "d4", "n1", "n2", "n3"]);
    expect(forLockedSonshas.map((row) => row.id)).toEqual(["d1", "d2", "d3", "d4", "n1", "n2", "n3"]);
    expect(forUnlockedSonshas.map((row) => row.id)).toEqual(["d1", "d2", "d3", "d4", "n1", "n2", "n3"]);
    expect(carvedHiddenDeposits(incoming, (row) => row.usd, (row) => row.at, users).map((row) => row.id)).toEqual([
      "d1",
      "d2",
      "d3",
      "d4",
      "n1",
      "n2",
      "n3",
    ]);
    expect(incoming.map((row) => reportingSplit(row.usd, row.at).net)).toEqual([8, 8, 8, 56, 8, 8, 64]);
  });

  it("freezes filtered lifetime money at the baseline until new deposits arrive", () => {
    expect(
      moneyKesForViewer({
        viewerEmail: "rulieeykenya@gmail.com",
        fullKes: 50_000,
        visibleDeposits: [{ amountKes: 500, amountUsd: null, at: "2026-11-01T00:00:00.000Z" }],
        kesPerUsd: 130,
      }),
    ).toBe(RULLI_BASELINE_MONEY_KES);
    expect(
      moneyKesForViewer({
        viewerEmail: "sonshasopunga@gmail.com",
        fullKes: 50_000,
        visibleDeposits: [{ amountKes: 500, amountUsd: null, at: "2026-11-01T00:00:00.000Z" }],
        kesPerUsd: 130,
        unlocked: false,
      }),
    ).toBe(RULLI_BASELINE_MONEY_KES);
    expect(
      moneyKesForViewer({
        viewerEmail: "sonshasopunga@gmail.com",
        fullKes: 50_000,
        visibleDeposits: [{ amountKes: 500, amountUsd: null, at: "2026-11-01T00:00:00.000Z" }],
        kesPerUsd: 130,
        unlocked: true,
      }),
    ).toBe(50_000);
    expect(
      moneyKesForViewer({
        viewerEmail: "rulieeykenya@gmail.com",
        fullKes: 50_000,
        visibleDeposits: [{ amountKes: 500, amountUsd: null, at: "2026-11-22T12:00:00.000Z" }],
        kesPerUsd: 130,
      }),
    ).toBe(RULLI_BASELINE_MONEY_KES + 500);
  });

  it("keeps each payment net when a later payment arrives", () => {
    const laterToday = "2026-11-23";
    const feeDay = "2026-11-22";
    const first = [1, 2, 3, 4, 5].map((n) => ({
      id: `p${n}`,
      userId: "u2",
      usd: 10,
      at: `2026-11-22T0${n}:00:00.000Z`,
    }));
    const earlyNets = first.map((row) => reportingSplit(row.usd, row.at).net);
    expect(earlyNets).toEqual([8, 8, 8, 8, 8]);
    const earlyVisible = depositsForViewerOnDay(
      first,
      "rulieeykenya@gmail.com",
      feeDay,
      laterToday,
      (row) => row.usd,
      (row) => row.at,
      users,
    );
    expect(earlyVisible.map((row) => row.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);

    const withLater = [
      ...first,
      { id: "p6", userId: "u3", usd: 10, at: "2026-11-22T06:00:00.000Z" },
      { id: "p7", userId: "u4", usd: 80, at: "2026-11-22T07:00:00.000Z" },
    ];
    expect(withLater.slice(0, 5).map((row) => reportingSplit(row.usd, row.at).net)).toEqual(earlyNets);
    const dayNet = withLater.reduce((sum, row) => sum + reportingSplit(row.usd, row.at).net, 0);
    const dayGross = withLater.reduce((sum, row) => sum + row.usd, 0);
    expect(dayNet).toBe(112);
    expect(dayGross).toBe(140);
    expect(dayNet).toBe(dayGross - withLater.reduce((sum, row) => sum + reportingSplit(row.usd, row.at).fee, 0));
  });

  it("shows full historical day deposits to filtered viewers, but filters today", () => {
    const today = "2026-11-22";
    const yesterday = "2026-11-21";
    const dayDeposits = [
      { id: "y1", userId: "u1", usd: 20, at: "2026-11-21T10:00:00.000Z" },
      { id: "y2", userId: "u2", usd: 30, at: "2026-11-21T12:00:00.000Z" },
      { id: "t1", userId: "u1", usd: 40, at: "2026-11-22T10:00:00.000Z" },
      { id: "t2", userId: "u3", usd: 50, at: "2026-11-22T12:00:00.000Z" },
    ];
    const past = depositsForViewerOnDay(
      dayDeposits,
      "rulieeykenya@gmail.com",
      yesterday,
      today,
      (row) => row.usd,
      (row) => row.at,
      users,
    );
    const todayRows = depositsForViewerOnDay(
      dayDeposits,
      "rulieeykenya@gmail.com",
      today,
      today,
      (row) => row.usd,
      (row) => row.at,
      users,
    );
    const lockedSonshasToday = depositsForViewerOnDay(
      dayDeposits,
      "sonshasopunga@gmail.com",
      today,
      today,
      (row) => row.usd,
      (row) => row.at,
      users,
      false,
    );
    const unlockedSonshasToday = depositsForViewerOnDay(
      dayDeposits,
      "sonshasopunga@gmail.com",
      today,
      today,
      (row) => row.usd,
      (row) => row.at,
      users,
      true,
    );
    expect(past.map((row) => row.id)).toEqual(["y1", "y2"]);
    expect(todayRows.map((row) => row.id)).toEqual(["t1", "t2"]);
    expect(lockedSonshasToday.map((row) => row.id)).toEqual(["t1", "t2"]);
    expect(unlockedSonshasToday.map((row) => row.id)).toEqual(["t1", "t2"]);
  });

  it("uses full past + filtered today for week/month spans", () => {
    const today = "2026-11-22";
    const spanDeposits = [
      { id: "p1", userId: "u1", usd: 20, at: "2026-11-20T10:00:00.000Z" },
      { id: "p2", userId: "u2", usd: 30, at: "2026-11-21T10:00:00.000Z" },
      { id: "t1", userId: "u1", usd: 40, at: "2026-11-22T10:00:00.000Z" },
      { id: "t2", userId: "u3", usd: 50, at: "2026-11-22T12:00:00.000Z" },
    ];
    const week = depositsForViewerInSpan(
      spanDeposits,
      "rulieeykenya@gmail.com",
      "2026-11-16",
      today,
      today,
      (row) => row.usd,
      (row) => row.at,
      users,
    );
    expect(week.map((row) => row.id)).toEqual(["p1", "p2", "t1", "t2"]);

    const yesterdayPeriod = depositsForViewerInPeriod(
      spanDeposits,
      "rulieeykenya@gmail.com",
      "yesterday",
      today,
      today,
      (row) => row.usd,
      (row) => row.at,
      users,
    );
    expect(yesterdayPeriod.map((row) => row.id)).toEqual(["p2"]);
  });
});

describe("nairobiDayEarnings", () => {
  const rows = [
    { id: "y1", usd: 20, at: "2026-11-21T10:00:00.000Z" },
    { id: "y2", usd: 30, at: "2026-11-21T12:00:00.000Z" },
    { id: "a", usd: 10, at: "2026-11-22T01:00:00.000Z" },
    { id: "b", usd: 10, at: "2026-11-22T02:00:00.000Z" },
    { id: "c", usd: 10, at: "2026-11-22T03:00:00.000Z" },
    { id: "d", usd: 10, at: "2026-11-22T04:00:00.000Z" },
    { id: "e", usd: 10, at: "2026-11-22T05:00:00.000Z" },
    { id: "other", usd: 80, at: "2026-11-23T08:00:00.000Z" },
  ];
  const amount = (row: { usd: number }) => row.usd;
  const at = (row: { at: string }) => row.at;

  it("includes the retained cut in the full day total", () => {
    const day = nairobiDayEarnings(rows, "2026-11-22", amount, at);
    expect(day.chargesFee).toBe(true);
    expect(day.paymentCount).toBe(5);
    expect(day.fullUsd).toBe(50);
    expect(day.hidden.map((row) => row.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(day.hiddenUsd).toBe(10);
    expect(day.visibleUsd).toBe(40);
    expect(day.fullUsd).toBe(day.hiddenUsd + day.visibleUsd);
  });

  it("keeps days before the fee start fully visible", () => {
    const day = nairobiDayEarnings(rows, "2026-11-21", amount, at);
    expect(day.chargesFee).toBe(false);
    expect(day.hidden).toEqual([]);
    expect(day.hiddenUsd).toBe(0);
    expect(day.fullUsd).toBe(50);
    expect(day.visibleUsd).toBe(50);
    expect(day.rows.map((row) => row.id)).toEqual(["y1", "y2"]);
  });
});

describe("Nairobi earnings periods", () => {
  it("maps UTC instants to Nairobi calendar days", () => {
    expect(nairobiDateKey("2026-11-12T20:30:00.000Z")).toBe("2026-11-12");
    expect(nairobiDateKey("2026-11-12T21:05:00.000Z")).toBe("2026-11-13");
  });

  it("selects yesterday independently of today/week/month", () => {
    const today = "2026-11-13";
    const yesterday = shiftDateKey(today, -1);
    expect(yesterday).toBe("2026-11-12");
    expect(dateKeyInEarningsPeriod(yesterday, "yesterday", today, today)).toBe(true);
    expect(dateKeyInEarningsPeriod(today, "yesterday", today, today)).toBe(false);
    expect(dateKeyInEarningsPeriod(yesterday, "today", today, today)).toBe(false);
    expect(dateKeyInEarningsPeriod(yesterday, "week", today, today)).toBe(true);
    expect(weekStartKey(today)).toBe("2026-11-09");
  });
});
