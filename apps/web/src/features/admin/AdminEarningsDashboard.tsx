import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, PageHeader, Skeleton, Stat } from "@/components/ui";
import {
  displayedEarnedTotalKes,
  formatEarnedKes,
  splitAdminVisibleKes,
} from "@/domain/admin-earnings";
import type { AdminDashboard } from "@/services/admin-dashboard";
import { useAuthSession } from "@/hooks/useAuth";
import { adminDashboardService } from "@/services/admin-dashboard";

export function AdminEarningsDashboard() {
  const { isSignedIn } = useAuthSession();
  const [dash, setDash] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isSignedIn) return;
    setLoading(true);
    try {
      const result = await adminDashboardService.load();
      if (result.ok) {
        setDash(result.data);
        setError(null);
      } else {
        setDash(null);
        setError(result.error === "Forbidden" ? "This page is limited to the two admin accounts." : result.error);
      }
    } catch (err) {
      setDash(null);
      setError(err instanceof Error && err.message ? err.message : "Could not load the dashboard.");
    } finally {
      setLoading(false);
    }
  }, [isSignedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  const ready = dash != null;
  const earnedKes = displayedEarnedTotalKes(dash?.totals.earnedTotalKes);
  const earnedSplit = useMemo(() => splitAdminVisibleKes(earnedKes), [earnedKes]);

  return (
    <div className="space-y-8" data-testid="admin-earnings">
      <PageHeader
        title="Earnings"
        subtitle="Total money earned is split 50% and 50%. Each admin then pays a 5% receivers share of that total."
        actions={
          isSignedIn ? (
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          ) : null
        }
      />

      {!isSignedIn ? <Alert tone="mist">Sign in with an admin account to see the earnings split.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {isSignedIn && loading && !ready ? <Skeleton className="h-28" /> : null}

      {ready ? (
        <>
          <section className="space-y-3" data-testid="admin-earned-total">
            <h2 className="font-display text-lg font-semibold text-paper">Total earned</h2>
            <Stat label="Total earned" value={formatEarnedKes(earnedKes)} hint="Total money earned" tone="live" />
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-lg font-semibold text-paper">Admin split</h2>
            <p className="text-sm text-mist">
              {`Total money earned is ${formatEarnedKes(earnedSplit.sharedKes)}. sonshas and rulli each receive 50%. A 5% receivers share of that total is taken from each admin.`}
            </p>
            <div className="grid gap-3 md:grid-cols-2" data-testid="earnings-split">
              {earnedSplit.shares.map((share) => (
                <Card key={share.key} data-testid={`earnings-share-${share.key}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-mist">50%</p>
                  <h3 className="font-display text-lg font-semibold text-paper">{share.key}</h3>
                  <p className="text-xs text-mist">{share.email}</p>
                  <p className="mt-4 font-mono text-2xl font-semibold text-live">{formatEarnedKes(share.netKes)}</p>
                  <p className="mt-1 text-xs text-paper">Earned after 5% charge</p>
                  <p className="mt-2 text-xs text-mist">50% split {formatEarnedKes(share.grossKes)}</p>
                  <p className="text-xs text-mist">Receivers share 5% {formatEarnedKes(share.chargeKes)}</p>
                </Card>
              ))}
            </div>
          </section>

          <section className="space-y-3" data-testid="earnings-charge">
            <h2 className="font-display text-lg font-semibold text-paper">Receivers share</h2>
            <p className="text-sm text-mist">
              Each receivers share is 5% of the total earned, taken from that admin&apos;s 50%. The two receivers shares stay separate.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {earnedSplit.shares.map((share) => (
                <Stat
                  key={share.key}
                  label={`${share.key} receivers share 5%`}
                  value={formatEarnedKes(share.chargeKes)}
                  hint="5% of total earned"
                />
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {earnedSplit.shares.map((share) => (
                <Stat
                  key={`${share.key}-net`}
                  label={`${share.key} earned after 5% charge`}
                  value={formatEarnedKes(share.netKes)}
                  hint="50% minus the 5% receivers share"
                  tone="live"
                />
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
