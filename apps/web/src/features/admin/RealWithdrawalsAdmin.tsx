import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Input, Select } from "@/components/ui";
import { kesToUsd } from "@/domain/megapay";
import {
  localPhoneDisplay,
  withdrawalStatusLabel,
  type WithdrawalStatus,
} from "@/domain/withdrawals";
import { useAuthSession } from "@/hooks/useAuth";
import { formatMoney } from "@/lib/format";
import {
  identityOnFile,
  recordFromAdminRow,
  type KycRecord,
} from "@/lib/kyc";
import { withdrawStepOn } from "@/lib/external-payments";
import { adminUsersService } from "@/services/admin-users";
import {
  withdrawalService,
  type AdminWithdrawalList,
  type AdminWithdrawalRow,
} from "@/services/withdrawals";
import { realAccountShort } from "@/lib/branding";

type Filter = "OPEN" | "ALL" | WithdrawalStatus;

function usdFromKes(value: number | null, rate: number): string {
  if (value == null) return "—";
  return formatMoney(kesToUsd(value, rate > 0 ? rate : 130));
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

function payoutIdentityReady(
  email: string | null,
  byEmail: Map<string, KycRecord>,
): boolean {
  if (!withdrawStepOn("verification", email)) return true;
  if (!email) return false;
  return identityOnFile(byEmail.get(email.trim().toLowerCase()) ?? null);
}

function IdentityForPayout({
  email,
  record,
}: {
  email: string | null;
  record: KycRecord | null;
}) {
  const photos = record
    ? [
        ["Front", record.idFront],
        ["Back", record.idBack],
        ["Holding ID", record.idHolding],
      ]
    : [];
  return (
    <div
      className="mt-3 rounded-lg border border-line bg-ink px-3 py-2 text-xs"
      data-testid="admin-withdrawal-identity"
    >
      <p className="font-semibold text-paper">
        KYC documents (review before paying)
      </p>
      {withdrawStepOn("verification", email) ? (
        identityOnFile(record) && record ? (
          <>
            <p className="mt-1 text-mist">
              {record.status === "approved"
                ? "Approved — match these photos to the M-Pesa name before you send."
                : record.status === "rejected"
                  ? "Rejected — do not pay until the user re-submits and you approve."
                  : "Pending your review — match these photos to the M-Pesa name, then approve on Admin → Verification if needed."}
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {photos.map(([label, src]) => (
                <figure key={label}>
                  <img
                    src={src}
                    alt={label}
                    className="h-24 w-full rounded bg-ink-2 object-contain"
                  />
                  <figcaption className="mt-1 text-center text-[10px] text-mist">
                    {label}
                  </figcaption>
                </figure>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-1 text-danger">
            No ID photos yet. The user is prompted after requesting. Do not send
            this payout until front, back, and holding-ID photos are on file.
          </p>
        )
      ) : (
        <p className="mt-1 text-mist">
          Account verification is off for all users.
        </p>
      )}
    </div>
  );
}

function tone(status: string): "warn" | "signal" | "call" | "danger" | "mist" {
  if (status === "COMPLETED") return "call";
  if (status === "FAILED") return "danger";
  if (status === "PROCESSING") return "signal";
  if (status === "CANCELLED") return "mist";
  return "warn";
}

export function RealWithdrawalsAdmin() {
  const { isSignedIn, user } = useAuthSession();
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [list, setList] = useState<AdminWithdrawalList | null>(null);
  const [kycByEmail, setKycByEmail] = useState<Map<string, KycRecord>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSignedIn) return;
    setLoading(true);
    const [result, kyc] = await Promise.all([
      withdrawalService.adminList(filter),
      adminUsersService.kycList(),
    ]);
    setLoading(false);
    if (result.ok) {
      setList(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
    if (kyc.ok) {
      const next = new Map<string, KycRecord>();
      for (const row of kyc.data.rows) {
        const record = recordFromAdminRow(row);
        if (!record) continue;
        const existing = next.get(record.email);
        if (
          !existing ||
          record.submittedAt.localeCompare(existing.submittedAt) > 0
        ) {
          next.set(record.email, record);
        }
      }
      setKycByEmail(next);
    }
  }, [filter, isSignedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isSignedIn || !user?.id) return;
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [isSignedIn, user?.id, load]);

  async function act(
    row: AdminWithdrawalRow,
    action: "processing" | "complete" | "fail",
  ) {
    const receipt = (receipts[row.id] ?? "").trim();
    const reason = (reasons[row.id] ?? "").trim();
    if (action === "complete" && !receipt) {
      setError(
        "Enter the M-Pesa receipt (transaction code) from the payment you made before completing.",
      );
      return;
    }
    if (action === "fail" && !reason) {
      setError(
        "Enter the reason the payout could not be made. It is shown to the user and the hold is refunded.",
      );
      return;
    }
    if (
      action === "complete" &&
      !window.confirm(
        `Confirm ${usdFromKes(row.netKes, list?.kesPerUsd ?? 130)} was sent to ${localPhoneDisplay(row.msisdn)} (receipt ${receipt.toUpperCase()})?`,
      )
    )
      return;
    if (
      action === "fail" &&
      !window.confirm(
        `Mark ${row.reference ?? row.id} as FAILED and refund ${formatMoney(row.amountUsd)} to the user?`,
      )
    )
      return;
    setBusyId(row.id);
    setError(null);
    const result = await withdrawalService.adminAct(action, row.id, {
      receipt,
      reason,
    });
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(
      action === "complete"
        ? `${row.reference ?? row.id} marked COMPLETED with receipt ${receipt.toUpperCase()}.`
        : action === "fail"
          ? `${row.reference ?? row.id} marked FAILED; ${formatMoney(row.amountUsd)} refunded to the user.`
          : `${row.reference ?? row.id} is now PROCESSING.`,
    );
    await load();
  }

  if (!isSignedIn) {
    return (
      <Alert tone="mist">
        Sign in with an admin account to see and pay {realAccountShort()}{" "}
        withdrawals.
      </Alert>
    );
  }

  const rows = list?.withdrawals ?? [];
  return (
    <div className="space-y-3" data-testid="real-withdrawals-admin">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label="Show"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="OPEN">Open (PENDING + PROCESSING)</option>
            <option value="ALL">All</option>
            <option value="PENDING">PENDING</option>
            <option value="PROCESSING">PROCESSING</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="FAILED">FAILED</option>
          </Select>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        {list ? (
          <p className="text-xs text-mist">
            Payout mode:{" "}
            <span className="font-semibold text-paper">
              Manual — review KYC, pay from the business M-Pesa, then enter the
              receipt
            </span>
            {" · "}fee {usdFromKes(list.feeKes, list.kesPerUsd)}
          </p>
        ) : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="signal">{notice}</Alert> : null}

      {list && rows.length === 0 ? (
        <p className="text-sm text-mist">
          No {realAccountShort()} withdrawals match this filter.
        </p>
      ) : null}

      <ul className="space-y-3">
        {rows.map((row) => {
          const open = row.status === "PENDING" || row.status === "PROCESSING";
          const busy = busyId === row.id;
          return (
            <li
              key={row.id}
              className="rounded-xl border border-line bg-ink-2/60 p-3 text-sm"
              data-testid="admin-withdrawal-row"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-xs text-mist">
                    {row.reference ?? row.id}
                  </p>
                  <p className="font-semibold text-paper">
                    {row.userName ?? "Unnamed user"}
                  </p>
                  <p className="text-xs text-mist">
                    {row.userEmail ?? row.userId}
                  </p>
                </div>
                <div className="text-right">
                  <Badge tone={tone(row.status)}>{row.status}</Badge>
                  <p className="mt-1 text-xs text-mist">
                    {withdrawalStatusLabel(row.status)}
                  </p>
                </div>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <dt className="text-mist">Pay to M-Pesa</dt>
                <dd className="font-mono text-paper">
                  {localPhoneDisplay(row.msisdn) || "—"}
                </dd>
                <dt className="text-mist">Send (net)</dt>
                <dd className="font-mono font-semibold text-live">
                  {usdFromKes(row.netKes, list?.kesPerUsd ?? 130)}
                </dd>
                <dt className="text-mist">Held from wallet</dt>
                <dd className="font-mono">{formatMoney(row.amountUsd)}</dd>
                <dt className="text-mist">Fee</dt>
                <dd className="font-mono">
                  {usdFromKes(row.feeKes, list?.kesPerUsd ?? 130)}
                </dd>
                <dt className="text-mist">Requested</dt>
                <dd>{when(row.createdAt)}</dd>
                <dt className="text-mist">Processing</dt>
                <dd>{when(row.processingAt)}</dd>
                <dt className="text-mist">Completed</dt>
                <dd>{when(row.completedAt)}</dd>
                <dt className="text-mist">Failed</dt>
                <dd>{when(row.failedAt)}</dd>
                {row.receipt ? (
                  <>
                    <dt className="text-mist">M-Pesa receipt</dt>
                    <dd className="font-mono">{row.receipt}</dd>
                  </>
                ) : null}
                {row.failureReason ? (
                  <>
                    <dt className="text-mist">Failure reason</dt>
                    <dd className="text-danger">{row.failureReason}</dd>
                  </>
                ) : null}
                {row.provider ? (
                  <>
                    <dt className="text-mist">Provider</dt>
                    <dd>{row.provider}</dd>
                  </>
                ) : null}
                {row.adminNote ? (
                  <>
                    <dt className="text-mist">Note</dt>
                    <dd className="sm:col-span-3">{row.adminNote}</dd>
                  </>
                ) : null}
              </dl>
              <IdentityForPayout
                email={row.userEmail}
                record={
                  row.userEmail
                    ? (kycByEmail.get(row.userEmail.trim().toLowerCase()) ??
                      null)
                    : null
                }
              />

              {open ? (
                <div className="mt-3 grid gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_auto]">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      label="M-Pesa receipt (after you have paid)"
                      placeholder="e.g. SG63XXXXXX"
                      value={receipts[row.id] ?? ""}
                      onChange={(e) =>
                        setReceipts((s) => ({
                          ...s,
                          [row.id]: e.target.value.toUpperCase(),
                        }))
                      }
                      disabled={busy}
                    />
                    <Input
                      label="Reason (only if the payout cannot be made)"
                      placeholder="e.g. Number not registered on M-Pesa"
                      value={reasons[row.id] ?? ""}
                      onChange={(e) =>
                        setReasons((s) => ({ ...s, [row.id]: e.target.value }))
                      }
                      disabled={busy}
                    />
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    {row.status === "PENDING" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void act(row, "processing")}
                      >
                        Mark processing
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        busy ||
                        !(receipts[row.id] ?? "").trim() ||
                        !payoutIdentityReady(row.userEmail, kycByEmail)
                      }
                      onClick={() => void act(row, "complete")}
                    >
                      Complete (money sent)
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={busy || !(reasons[row.id] ?? "").trim()}
                      onClick={() => void act(row, "fail")}
                    >
                      Fail + refund
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
