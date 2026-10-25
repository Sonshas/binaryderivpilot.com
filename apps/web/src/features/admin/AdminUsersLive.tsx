import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Textarea,
} from "@/components/ui";
import { formatMoney } from "@/lib/format";
import {
  USER_WITHDRAW_STEP_COLUMN,
  WITHDRAW_STEPS,
  WITHDRAW_STEP_LABEL,
  syncUserWithdrawStepsFromServer,
  syncWithdrawGatesClearedFromServer,
  type ExternalKind,
} from "@/lib/external-payments";
import {
  adminUsersService,
  type AdminUserListRow,
} from "@/services/admin-users";
import { withdrawalService } from "@/services/withdrawals";

const KYC_STATUSES = [
  "not_started",
  "pending",
  "under_review",
  "approved",
  "rejected",
] as const;

type Filter =
  | "all"
  | "disabled"
  | "kyc_pending"
  | "open_withdraw"
  | "deposited_no_trades";
type Tab =
  | "overview"
  | "money"
  | "trades"
  | "kyc"
  | "support"
  | "audit"
  | "notify";

function money(n: number) {
  return formatMoney(n);
}

function when(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function matches(row: AdminUserListRow, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const phone = row.phone.replace(/\D/g, "");
  const needle = q.replace(/\D/g, "");
  return (
    (row.email ?? "").toLowerCase().includes(q) ||
    (row.name ?? "").toLowerCase().includes(q) ||
    (needle.length >= 3 && phone.includes(needle))
  );
}

function filterRow(row: AdminUserListRow, filter: Filter) {
  if (filter === "disabled") return row.account_status === "suspended";
  if (filter === "kyc_pending") return row.kyc_status === "pending";
  if (filter === "open_withdraw") return row.open_withdrawals > 0;
  if (filter === "deposited_no_trades")
    return row.collected_count > 0 && row.trade_count === 0;
  return true;
}

function UserDetail({
  userId,
  onBack,
}: {
  userId: string;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("10");
  const [note, setNote] = useState("Admin adjustment");
  const [winRate, setWinRate] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [staffNote, setStaffNote] = useState("");
  const [notifyTitle, setNotifyTitle] = useState("");
  const [notifyBody, setNotifyBody] = useState("");
  const [receipt, setReceipt] = useState("");

  const load = useCallback(async () => {
    const result = await adminUsersService.get(userId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDetail(result.data);
    const user = result.data.user as Record<string, unknown>;
    setWinRate(
      user.win_rate_percent == null ? "" : String(user.win_rate_percent),
    );
    setPhone(String(user.phone ?? ""));
    setCountry(String(user.country ?? ""));
    setStaffNote(String(user.staff_note ?? ""));
    const email = String(user.email ?? "");
    syncUserWithdrawStepsFromServer(email, {
      verification: user.withdraw_verification_enabled as boolean | null,
      scanner: user.withdraw_scanner_enabled as boolean | null,
      tax: user.withdraw_tax_enabled as boolean | null,
    });
    syncWithdrawGatesClearedFromServer(
      email,
      user.withdraw_gates_cleared === true,
    );
    setError("");
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const user = (detail?.user ?? null) as Record<string, unknown> | null;

  async function saveFlags(patch: Record<string, unknown>) {
    setBusy(true);
    const result = await adminUsersService.update(userId, patch);
    setBusy(false);
    setNotice(result.ok ? "Saved." : result.error);
    if (result.ok) void load();
  }

  function stepOverride(kind: ExternalKind): boolean | null {
    const col = USER_WITHDRAW_STEP_COLUMN[kind];
    const value = user?.[col];
    if (value === false) return false;
    if (value === true) return true;
    return null;
  }

  async function saveWithdrawSteps(
    next: Partial<Record<ExternalKind, boolean | null>>,
  ) {
    const patch: Record<string, unknown> = {};
    for (const kind of WITHDRAW_STEPS) {
      if (kind in next) {
        patch[USER_WITHDRAW_STEP_COLUMN[kind]] = next[kind] ?? null;
      }
    }
    await saveFlags(patch);
  }

  async function adjust(direction: 1 | -1) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setNotice("Enter an amount above zero.");
      return;
    }
    setBusy(true);
    const result = await adminUsersService.adjustBalance(
      userId,
      direction * value,
      note,
    );
    setBusy(false);
    setNotice(result.ok ? "Balance updated." : result.error);
    if (result.ok) void load();
  }

  if (error && !user) {
    return (
      <div>
        <PageHeader
          title="User"
          actions={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onBack}
            >
              All users
            </Button>
          }
        />
        <p className="text-sm text-put">{error}</p>
      </div>
    );
  }
  if (!user) return <p className="text-sm text-mist">Loading…</p>;

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "money", label: "Money" },
    { id: "trades", label: "Trades" },
    { id: "kyc", label: "KYC" },
    { id: "support", label: "Support" },
    { id: "audit", label: "Audit" },
    { id: "notify", label: "Notify" },
  ];

  const deposits = (detail?.deposits as Record<string, unknown>[]) ?? [];
  const withdrawals = (detail?.withdrawals as Record<string, unknown>[]) ?? [];
  const transactions =
    (detail?.transactions as Record<string, unknown>[]) ?? [];
  const trades = (detail?.trades as Record<string, unknown>[]) ?? [];
  const tickets = (detail?.tickets as Record<string, unknown>[]) ?? [];
  const kycReviews = (detail?.kyc_reviews as Record<string, unknown>[]) ?? [];
  const audit = (detail?.audit as Record<string, unknown>[]) ?? [];

  return (
    <div>
      <PageHeader
        title={String(user.name || user.display_name || user.email || "User")}
        subtitle={String(user.email ?? userId)}
        actions={
          <Button type="button" variant="secondary" size="sm" onClick={onBack}>
            All users
          </Button>
        }
      />
      {notice ? <p className="mb-3 text-sm text-signal">{notice}</p> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={tab === item.id ? "primary" : "secondary"}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="space-y-3">
            <p className="text-sm text-mist">
              {String(user.phone || "No phone")} ·{" "}
              {String(user.country || "No country")} · {String(user.role)} · KYC{" "}
              {String(user.kyc_status)}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={user.account_status !== "suspended"}
                disabled={busy}
                onChange={(e) =>
                  void saveFlags({
                    account_status: e.target.checked ? "active" : "suspended",
                  })
                }
              />
              Can sign in (account active)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={user.deposits_enabled !== false}
                disabled={busy}
                onChange={(e) =>
                  void saveFlags({ deposits_enabled: e.target.checked })
                }
              />
              Deposits enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={user.withdrawals_enabled !== false}
                disabled={busy}
                onChange={(e) =>
                  void saveFlags({ withdrawals_enabled: e.target.checked })
                }
              />
              Withdrawals enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={user.is_vip === true}
                disabled={busy}
                onChange={(e) => void saveFlags({ is_vip: e.target.checked })}
                data-testid="user-is-vip"
              />
              VIP (uses VIP win rate when override is empty)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={user.withdraw_gates_cleared === true}
                disabled={busy}
                onChange={(e) =>
                  void saveFlags({ withdraw_gates_cleared: e.target.checked })
                }
                data-testid="user-gates-cleared"
              />
              Withdraw gates cleared (skip verification / scanner / tax)
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-sm">
                <span className="mb-1 block text-mist">KYC status</span>
                <select
                  className="h-11 rounded-xl border border-line bg-ink-2 px-3 text-sm text-paper"
                  value={String(user.kyc_status ?? "not_started")}
                  disabled={busy}
                  onChange={(e) =>
                    void saveFlags({ kyc_status: e.target.value })
                  }
                  data-testid="user-kyc-status"
                >
                  {KYC_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="space-y-2 border-t border-line pt-3">
              <p className="text-sm font-semibold text-paper">
                Withdrawal steps for this account
              </p>
              {WITHDRAW_STEPS.map((kind) => {
                const override = stepOverride(kind);
                return (
                  <label
                    key={kind}
                    className="flex items-center gap-2 text-sm text-paper"
                  >
                    <input
                      type="checkbox"
                      checked={override !== false}
                      disabled={busy}
                      onChange={(e) =>
                        void saveWithdrawSteps({ [kind]: e.target.checked })
                      }
                      data-testid={`user-step-${kind}`}
                    />
                    {WITHDRAW_STEP_LABEL[kind]}
                    {override == null ? (
                      <span className="text-xs text-mist">(global)</span>
                    ) : null}
                  </label>
                );
              })}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="text-sm font-semibold text-put"
                  disabled={busy}
                  onClick={() =>
                    void saveWithdrawSteps({
                      verification: false,
                      scanner: false,
                      tax: false,
                    })
                  }
                  data-testid="user-steps-all-off"
                >
                  Turn all three off
                </button>
                <button
                  type="button"
                  className="text-sm font-semibold text-signal"
                  disabled={busy}
                  onClick={() =>
                    void saveWithdrawSteps({
                      verification: null,
                      scanner: null,
                      tax: null,
                    })
                  }
                  data-testid="user-steps-reset"
                >
                  Use the setting for all users
                </button>
              </div>
              <p className="text-xs text-mist">
                A step turned off here is skipped for this account. Scanner and
                tax still stay hidden when their amount is zero.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                label="Win rate override %"
                value={winRate}
                onChange={(e) => setWinRate(e.target.value)}
                placeholder="empty = global"
              />
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void saveFlags({
                    win_rate_percent:
                      winRate.trim() === "" ? null : Number(winRate),
                  })
                }
              >
                Save win rate
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                label="Phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <Input
                label="Country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </div>
            <Textarea
              label="Staff note (internal)"
              value={staffNote}
              onChange={(e) => setStaffNote(e.target.value)}
              rows={3}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void saveFlags({ phone, country, staff_note: staffNote })
                }
              >
                Save profile
              </Button>
              <select
                className="h-11 rounded-xl border border-line bg-ink-2 px-3 text-sm text-paper"
                value={String(user.role ?? "trader")}
                onChange={(e) =>
                  void saveFlags({
                    role: e.target.value,
                    app_role: e.target.value,
                  })
                }
              >
                {["trader", "finance", "admin", "superadmin", "support"].map(
                  (role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ),
                )}
              </select>
            </div>
          </Card>
          <Card className="space-y-3">
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs uppercase text-mist">Available</p>
                <p className="font-mono text-live">
                  {money(Number(user.available_usd ?? 0))}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-mist">Locked</p>
                <p className="font-mono">
                  {money(Number(user.locked_usd ?? 0))}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-mist">Balance</p>
                <p className="font-mono">
                  {money(Number(user.balance_usd ?? 0))}
                </p>
              </div>
            </div>
            <Input
              label="Amount (USD)"
              type="number"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => void adjust(1)}
              >
                Add
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void adjust(-1)}
              >
                Subtract
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "money" ? (
        <div className="space-y-4">
          <Card>
            <p className="mb-2 font-semibold">Deposits & service fees</p>
            {deposits.length === 0 ? (
              <p className="text-sm text-mist">No deposits.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {deposits.map((row) => (
                  <li
                    key={String(row.id)}
                    className="rounded-xl border border-line px-3 py-2"
                  >
                    {when(String(row.created_at))} · {String(row.status)} ·{" "}
                    {money(Number(row.amount))} ·{" "}
                    {String(
                      (
                        row.details as {
                          payment?: string;
                          kind?: string;
                        } | null
                      )?.payment ??
                        (row.details as { kind?: string } | null)?.kind ??
                        "Deposit",
                    )}
                    {row.mpesa_receipt ? ` · ${String(row.mpesa_receipt)}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <p className="mb-2 font-semibold">Withdrawals</p>
            {withdrawals.length === 0 ? (
              <p className="text-sm text-mist">No withdrawals.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {withdrawals.map((row) => (
                  <li
                    key={String(row.id)}
                    className="space-y-2 rounded-xl border border-line px-3 py-2"
                  >
                    <div>
                      {when(String(row.created_at))} · {String(row.status)} ·{" "}
                      {money(Number(row.amount))} · {String(row.msisdn ?? "")}
                    </div>
                    {row.status === "PENDING" || row.status === "PROCESSING" ? (
                      <div className="flex flex-wrap gap-2">
                        <Input
                          label="M-Pesa receipt"
                          value={receipt}
                          onChange={(e) => setReceipt(e.target.value)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy || !receipt.trim()}
                          onClick={async () => {
                            setBusy(true);
                            const result = await withdrawalService.adminAct(
                              "complete",
                              String(row.id),
                              {
                                receipt: receipt.trim(),
                              },
                            );
                            setBusy(false);
                            setNotice(
                              result.ok ? "Marked paid." : result.error,
                            );
                            if (result.ok) {
                              setReceipt("");
                              void load();
                            }
                          }}
                        >
                          Mark paid
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            const result = await withdrawalService.adminAct(
                              "fail",
                              String(row.id),
                              {
                                reason: "Rejected by admin",
                              },
                            );
                            setBusy(false);
                            setNotice(result.ok ? "Rejected." : result.error);
                            if (result.ok) void load();
                          }}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <p className="mb-2 font-semibold">Transactions</p>
            {transactions.length === 0 ? (
              <p className="text-sm text-mist">No transactions.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {transactions.map((row) => (
                  <li
                    key={String(row.id)}
                    className="rounded-xl border border-line px-3 py-2"
                  >
                    {when(String(row.created_at))} · {String(row.type)} ·{" "}
                    {money(Number(row.amount))} · {String(row.note ?? "")}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "trades" ? (
        <Card>
          {trades.length === 0 ? (
            <p className="text-sm text-mist">No real trades.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {trades.map((row) => (
                <li
                  key={String(row.id)}
                  className="rounded-xl border border-line px-3 py-2"
                >
                  {when(String(row.created_at))} · {String(row.symbol)} ·{" "}
                  {String(row.contract_option ?? row.contract_type)} · stake{" "}
                  {money(Number(row.stake))} · {String(row.status)} · P/L{" "}
                  {money(Number(row.profit_loss ?? 0))}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "kyc" ? (
        <Card className="space-y-3">
          {kycReviews.length === 0 ? (
            <p className="text-sm text-mist">No KYC submissions.</p>
          ) : (
            kycReviews.map((row) => (
              <div
                key={String(row.id)}
                className="rounded-xl border border-line px-3 py-2 text-sm"
              >
                <p>
                  {when(String(row.created_at))} · {String(row.status)}
                </p>
                <p className="text-mist">
                  {Array.isArray(row.document_paths)
                    ? row.document_paths.join(", ")
                    : "No paths"}
                </p>
                {String(row.status) === "pending" ||
                String(row.status) === "active" ? (
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const result = await adminUsersService.kycReview(
                          userId,
                          String(row.id),
                          "approved",
                        );
                        setBusy(false);
                        setNotice(result.ok ? "Approved." : result.error);
                        if (result.ok) void load();
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const result = await adminUsersService.kycReview(
                          userId,
                          String(row.id),
                          "rejected",
                        );
                        setBusy(false);
                        setNotice(result.ok ? "Rejected." : result.error);
                        if (result.ok) void load();
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </Card>
      ) : null}

      {tab === "support" ? (
        <Card>
          {tickets.length === 0 ? (
            <p className="text-sm text-mist">No support tickets.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {tickets.map((row) => (
                <li
                  key={String(row.id)}
                  className="rounded-xl border border-line px-3 py-2"
                >
                  {when(String(row.created_at))} · {String(row.status)} ·{" "}
                  {String(row.subject ?? "Ticket")}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "audit" ? (
        <Card>
          {audit.length === 0 ? (
            <p className="text-sm text-mist">
              No admin actions recorded for this user.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {audit.map((row) => (
                <li
                  key={String(row.id)}
                  className="rounded-xl border border-line px-3 py-2"
                >
                  {when(String(row.created_at))} ·{" "}
                  {String(row.actor_email ?? "admin")} · {String(row.action)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === "notify" ? (
        <Card className="space-y-3 max-w-lg">
          <Input
            label="Title"
            value={notifyTitle}
            onChange={(e) => setNotifyTitle(e.target.value)}
          />
          <Textarea
            label="Message"
            value={notifyBody}
            onChange={(e) => setNotifyBody(e.target.value)}
            rows={4}
          />
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const result = await adminUsersService.notify(
                userId,
                notifyTitle,
                notifyBody,
              );
              setBusy(false);
              setNotice(result.ok ? "Notification sent." : result.error);
              if (result.ok) {
                setNotifyTitle("");
                setNotifyBody("");
              }
            }}
          >
            Send notification
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

export function AdminUsersLivePage() {
  const [rows, setRows] = useState<AdminUserListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await adminUsersService.list();
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setRows([]);
      return;
    }
    setError("");
    setRows(result.data.users);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(
    () => rows.filter((row) => matches(row, query) && filterRow(row, filter)),
    [rows, query, filter],
  );

  if (selected)
    return (
      <UserDetail
        userId={selected}
        onBack={() => {
          setSelected(null);
          void refresh();
        }}
      />
    );

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Live accounts from Supabase. Search, filter, and open a member for full controls."
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["disabled", "Disabled"],
            ["kyc_pending", "KYC pending"],
            ["open_withdraw", "Open withdrawal"],
            ["deposited_no_trades", "Deposited, no trades"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={filter === id ? "primary" : "secondary"}
            onClick={() => setFilter(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="mb-3 max-w-md">
        <Input
          label="Find a user"
          placeholder="Email or phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error ? <p className="mb-3 text-sm text-put">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-mist">Loading users…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          title="No matching users"
          body="Try another search or filter."
        />
      ) : (
        <div className="grid gap-2">
          {visible.map((row) => (
            <button
              key={row.id}
              type="button"
              className="text-left"
              onClick={() => setSelected(row.id)}
              data-testid="admin-user-row"
            >
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {row.name || row.email || row.id}
                  </p>
                  <p className="text-sm text-mist">
                    {row.email}
                    {row.phone ? ` · ${row.phone}` : ""}
                    {row.country ? ` · ${row.country}` : ""}
                  </p>
                  <p className="text-xs text-mist">
                    Joined {when(row.created_at)} · collected{" "}
                    {money(row.collected_usd)} · {row.trade_count} trades
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-live">
                    {money(row.available_usd)}
                  </span>
                  <Badge
                    tone={row.account_status === "suspended" ? "put" : "call"}
                  >
                    {row.account_status === "suspended"
                      ? "Disabled"
                      : "Enabled"}
                  </Badge>
                  <Badge
                    tone={
                      row.kyc_status === "approved"
                        ? "call"
                        : row.kyc_status === "pending"
                          ? "signal"
                          : "mist"
                    }
                  >
                    KYC {row.kyc_status}
                  </Badge>
                  {row.open_withdrawals > 0 ? (
                    <Badge tone="signal">WD {row.open_withdrawals}</Badge>
                  ) : null}
                  <Badge tone="mist">{row.role}</Badge>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
