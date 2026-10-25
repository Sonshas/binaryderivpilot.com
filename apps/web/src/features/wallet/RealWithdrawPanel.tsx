import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Alert, Badge, Button, Card } from "@/components/ui";
import { kesToUsd, normalizeKenyanPhone } from "@/domain/megapay";
import {
  NO_REAL_TRADE_MESSAGE,
  isOpenWithdrawalStatus,
  localPhoneDisplay,
  minUsdFor,
  quoteWithdrawal,
  validateWithdrawalAmountUsd,
  withdrawalStatusLabel,
  type WithdrawalStatus,
} from "@/domain/withdrawals";
import { useAuthSession } from "@/hooks/useAuth";
import { useWallet } from "@/hooks/useWallet";
import { cn } from "@/lib/cn";
import {
  AmountChoices,
  WITHDRAW_AMOUNTS,
} from "@/features/payments/AmountChoices";
import {
  MoneyPair,
  formatKes,
  pairFromUsd,
} from "@/features/payments/MoneyPair";
import { MpesaPhoneChoice } from "@/features/payments/MpesaPhoneChoice";
import {
  enabledWithdrawSteps,
  externalPaid,
  firstIncompleteWithdrawIndex,
  hasPendingWithdrawGates,
  markExternalPaid,
  readDefaultKesPerUsd,
  readScannerFeeUsd,
  readTaxFeeUsd,
  readVerificationFeeUsd,
  resumeWithdrawIndex,
  saveWithdrawPlace,
  withdrawGatesCleared,
  withdrawStepComplete,
  type ExternalKind,
} from "@/lib/external-payments";
import { formatMoney } from "@/lib/format";
import { markScannerPaid, scannerPaid } from "@/lib/scanner-access";
import { KycModal } from "@/features/wallet/KycModal";
import { WithdrawFeeModal } from "@/features/wallet/WithdrawFeeModal";
import { identityReady } from "@/features/wallet/WithdrawIdentity";
import {
  scannerFeeNote,
  taxFeeNote,
  verificationFeeNote,
} from "@/features/wallet/withdraw-gate-copy";
import { fetchOwnKyc, loadKyc } from "@/lib/kyc";
import { platformSettingsService } from "@/services/platform-settings";
import {
  withdrawalService,
  type WithdrawConfig,
  type WithdrawalState,
} from "@/services/withdrawals";
import { realAccountShort } from "@/lib/branding";
import { safeUserMessage } from "@/lib/safe-user-message";

type Phase = "form" | "submitting" | "gates" | "status";

/** Brief success screen before the first unfinished gate modal. */
const SUCCESS_THEN_GATES_MS = 1000;

const STATUS_TONE: Record<
  WithdrawalStatus,
  "live" | "signal" | "danger" | "mist"
> = {
  PENDING: "live",
  PROCESSING: "signal",
  COMPLETED: "live",
  FAILED: "danger",
  CANCELLED: "mist",
};

/** Member-facing status chip (backend may still be PENDING while request is accepted). */
function memberStatusBadge(status: WithdrawalStatus): string {
  switch (status) {
    case "PENDING":
      return "Successful";
    case "PROCESSING":
      return "Processing";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

function alertTone(status: WithdrawalStatus): "signal" | "danger" | "mist" {
  if (status === "FAILED") return "danger";
  if (status === "CANCELLED") return "mist";
  return "signal";
}

function statusSentence(
  withdrawal: WithdrawalState,
  kesPerUsd: number,
): string {
  const receive = `${formatMoney(kesToUsd(withdrawal.netKes, kesPerUsd))} (${formatKes(withdrawal.netKes)})`;
  const phone = localPhoneDisplay(withdrawal.msisdn) || "your M-Pesa number";
  switch (withdrawal.status) {
    case "PENDING":
      return `Withdrawal requested successfully. It will be processed shortly. ${receive} will be sent to ${phone}.`;
    case "PROCESSING":
      return `Your payout to M-Pesa (${phone}) is being processed.`;
    case "COMPLETED":
      return `Withdrawal completed — ${receive} sent to ${phone}${withdrawal.receipt ? ` (receipt ${withdrawal.receipt})` : ""}.`;
    case "FAILED":
      return "The payout could not be completed. Your balance has been refunded. Contact support if you need help.";
    case "CANCELLED":
      return "Cancelled. Your balance has been refunded.";
    default:
      return withdrawal.status;
  }
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

function skipDone(
  steps: ExternalKind[],
  start: number,
  email: string | null | undefined,
  identityDone: boolean,
): number {
  let index = start;
  while (
    index < steps.length &&
    withdrawStepComplete(steps[index]!, email, identityDone)
  )
    index += 1;
  return index;
}

export function RealWithdrawPanel({
  onClose,
  className,
}: {
  onClose: () => void;
  className?: string;
}) {
  const { user } = useAuthSession();
  const { wallet, loading: walletLoading } = useWallet("real");
  const [config, setConfig] = useState<WithdrawConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [kesText, setKesText] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [withdrawal, setWithdrawal] = useState<WithdrawalState | null>(null);
  const [scannerFee, setScannerFee] = useState(() => readScannerFeeUsd());
  const [verificationFee, setVerificationFee] = useState(() =>
    readVerificationFeeUsd(),
  );
  const [taxFee, setTaxFee] = useState(() => readTaxFeeUsd());
  const [promptKesPerUsd, setPromptKesPerUsd] = useState(() =>
    readDefaultKesPerUsd(),
  );
  const [settingsEpoch, setSettingsEpoch] = useState(0);
  const [scannerSettled, setScannerSettled] = useState(() =>
    scannerPaid(user?.email),
  );
  const [verificationPaid, setVerificationPaid] = useState(() =>
    externalPaid("verification", user?.email),
  );
  const [taxPaid, setTaxPaid] = useState(() =>
    externalPaid("tax", user?.email),
  );
  const [identityDone, setIdentityDone] = useState(() =>
    identityReady(loadKyc(user?.email)),
  );
  const requestLock = useRef(false);
  const gatesTimer = useRef<number | null>(null);

  const steps = useMemo(
    () => enabledWithdrawSteps(user?.email),
    [user?.email, settingsEpoch],
  );

  const [stepIndex, setStepIndex] = useState(() =>
    resumeWithdrawIndex(user?.email, identityReady(loadKyc(user?.email))),
  );
  const [phase, setPhase] = useState<Phase>(() =>
    hasPendingWithdrawGates(user?.email, identityReady(loadKyc(user?.email)))
      ? "gates"
      : "form",
  );

  useEffect(() => {
    let cancelled = false;
    void withdrawalService.getConfig().then((result) => {
      if (cancelled) return;
      if (result.ok) setConfig(result.data);
      else
        setConfigError(
          safeUserMessage(result.error, "Withdrawals temporarily unavailable"),
        );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reload Supabase withdraw fees/flags before gate UI — localStorage alone is stale after admin edits.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const settings = await platformSettingsService.load(user?.email);
      if (cancelled) return;
      if (settings.ok) {
        const w = settings.data.withdraw;
        setScannerFee(w.scannerUsd);
        setVerificationFee(w.verificationUsd);
        setTaxFee(w.taxUsd);
        setPromptKesPerUsd(w.defaultKesPerUsd);
        setSettingsEpoch((n) => n + 1);
      }
      setScannerSettled(scannerPaid(user?.email));
      setVerificationPaid(externalPaid("verification", user?.email));
      setTaxPaid(externalPaid("tax", user?.email));

      const record = await fetchOwnKyc(user?.email);
      if (cancelled) return;
      const identity = identityReady(record);
      setIdentityDone(identity);

      if (withdrawGatesCleared(user?.email, identity)) {
        saveWithdrawPlace(user?.email, "form");
        setPhase("form");
        return;
      }

      const open = await withdrawalService.getOpenMine();
      if (cancelled) return;
      if (open.ok && open.data) {
        setWithdrawal(open.data);
        setPhase("status");
        const index = firstIncompleteWithdrawIndex(user?.email, identity);
        setStepIndex(index);
        if (gatesTimer.current != null) window.clearTimeout(gatesTimer.current);
        gatesTimer.current = window.setTimeout(() => {
          gatesTimer.current = null;
          if (cancelled) return;
          const step = enabledWithdrawSteps(user?.email)[index];
          if (!step) {
            saveWithdrawPlace(user?.email, "form");
            return;
          }
          saveWithdrawPlace(user?.email, step);
          setPhase("gates");
        }, SUCCESS_THEN_GATES_MS);
        return;
      }

      if (hasPendingWithdrawGates(user?.email, identity)) {
        setStepIndex(resumeWithdrawIndex(user?.email, identity));
        setPhase("gates");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  const currentStep = phase === "gates" ? (steps[stepIndex] ?? null) : null;

  useEffect(() => {
    if (phase !== "gates") return;
    const place = steps[stepIndex];
    if (place) saveWithdrawPlace(user?.email, place);
  }, [phase, stepIndex, steps, user?.email]);

  useEffect(
    () => () => {
      if (gatesTimer.current != null) window.clearTimeout(gatesTimer.current);
    },
    [],
  );

  // Skip steps that became complete (e.g. KYC already on file).
  useEffect(() => {
    if (phase !== "gates") return;
    const next = skipDone(steps, stepIndex, user?.email, identityDone);
    if (next !== stepIndex) {
      setStepIndex(next);
      return;
    }
    if (next < steps.length) return;
    saveWithdrawPlace(user?.email, "form");
    setPhase(withdrawal ? "status" : "form");
  }, [phase, stepIndex, steps, user?.email, identityDone, withdrawal]);

  const openId =
    withdrawal && isOpenWithdrawalStatus(withdrawal.status)
      ? withdrawal.withdrawalId
      : null;
  useEffect(() => {
    if (!openId || !user?.id) return;
    const refresh = () => {
      void withdrawalService.getMine(openId).then((result) => {
        if (result.ok) setWithdrawal(result.data);
      });
    };
    return withdrawalService.subscribe(user.id, refresh, {
      channel: `withdraw-panel:${openId}`,
    });
  }, [openId, user?.id]);

  const available = wallet?.availableBalance ?? null;
  const hasRealBalance = available != null && available > 0;
  const configReady = Boolean(config && !walletLoading);

  const validation = useMemo(
    () =>
      config && amount.trim()
        ? validateWithdrawalAmountUsd(amount, config, available)
        : null,
    [config, amount, available],
  );
  const preview = useMemo(() => {
    if (!config) return null;
    if (validation?.ok) return validation.quote;
    const n = Number(amount);
    return Number.isFinite(n) && n > 0
      ? quoteWithdrawal(Math.round(n * 100) / 100, config)
      : null;
  }, [config, amount, validation]);

  /** Open first unfinished gate in admin order (steps already follow withdrawOrder). */
  async function openFirstIncompleteGate() {
    const record = await fetchOwnKyc(user?.email);
    const identity = identityReady(record);
    setIdentityDone(identity);
    const index = firstIncompleteWithdrawIndex(user?.email, identity);
    if (index >= steps.length) {
      saveWithdrawPlace(user?.email, "form");
      setPhase("status");
      return;
    }
    setStepIndex(index);
    saveWithdrawPlace(user?.email, steps[index]!);
    setPhase("gates");
  }

  function scheduleGatesAfterSuccess() {
    if (gatesTimer.current != null) window.clearTimeout(gatesTimer.current);
    gatesTimer.current = window.setTimeout(() => {
      gatesTimer.current = null;
      void openFirstIncompleteGate();
    }, SUCCESS_THEN_GATES_MS);
  }

  async function createWithdrawalShowSuccessThenGates() {
    if (requestLock.current || withdrawal) {
      if (withdrawal) {
        setPhase("status");
        scheduleGatesAfterSuccess();
      }
      return;
    }
    if (!config) {
      setPhase("form");
      return;
    }
    const check = validateWithdrawalAmountUsd(amount, config, available);
    if (!check.ok) {
      setError(check.error);
      setPhase("form");
      return;
    }
    const msisdn = normalizeKenyanPhone(phone);
    if (!msisdn) {
      setError("Enter a valid Safaricom M-Pesa number, e.g. 0712345678.");
      setPhase("form");
      return;
    }
    requestLock.current = true;
    setError(null);
    setPhase("submitting");
    const result = await withdrawalService.request(check.amountUsd, msisdn);
    requestLock.current = false;
    if (!result.ok) {
      setPhase("form");
      setError(
        safeUserMessage(
          result.error,
          "Withdrawal could not be started. Please try again.",
        ),
      );
      return;
    }
    setWithdrawal(result.data);
    saveWithdrawPlace(user?.email, "form");
    setPhase("status");
    scheduleGatesAfterSuccess();
  }

  async function advance() {
    const record = await fetchOwnKyc(user?.email);
    const identity = identityReady(record);
    setIdentityDone(identity);
    const current = steps[stepIndex];
    // Never skip an incomplete modal.
    if (current && !withdrawStepComplete(current, user?.email, identity)) return;
    const next = skipDone(steps, stepIndex + 1, user?.email, identity);
    if (next >= steps.length) {
      saveWithdrawPlace(user?.email, "form");
      setPhase("status");
      return;
    }
    setStepIndex(next);
    saveWithdrawPlace(user?.email, steps[next]!);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    const check = validateWithdrawalAmountUsd(amount, config, available);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    const msisdn = normalizeKenyanPhone(phone);
    if (!msisdn) {
      setError("Enter a valid Safaricom M-Pesa number, e.g. 0712345678.");
      return;
    }
    setError(null);
    // Success first (~1s), then first unfinished gate in admin order if any remain.
    await createWithdrawalShowSuccessThenGates();
  }

  function reset() {
    if (gatesTimer.current != null) {
      window.clearTimeout(gatesTimer.current);
      gatesTimer.current = null;
    }
    requestLock.current = false;
    setPhase("form");
    setError(null);
    setWithdrawal(null);
    setAmount("");
    setKesText("");
    saveWithdrawPlace(user?.email, "form");
  }

  function withdrawAll() {
    if (!config || available == null || available <= 0) return;
    const pair = pairFromUsd(
      Math.floor(available * 100) / 100,
      config.kesPerUsd,
    );
    setAmount(pair.usd);
    setKesText(pair.kes);
  }

  // ——— One gate modal at a time (never stack) ———
  if (
    phase === "gates" &&
    currentStep === "verification" &&
    user?.email &&
    !identityDone
  ) {
    return (
      <KycModal
        email={user.email}
        open
        onClose={onClose}
        onSubmitted={() => {
          setIdentityDone(true);
          // Same step may still need the optional verification fee modal.
          if (
            verificationFee > 0 &&
            !externalPaid("verification", user.email)
          ) {
            setIdentityDone(true);
            return;
          }
          void advance();
        }}
      />
    );
  }

  if (
    phase === "gates" &&
    currentStep === "verification" &&
    verificationFee > 0 &&
    !verificationPaid
  ) {
    return (
      <WithdrawFeeModal
        open
        title="Account verification"
        note={verificationFeeNote(verificationFee, promptKesPerUsd)}
        testId="withdraw-verification-fee"
        kind="verification"
        amountUsd={verificationFee}
        paid={verificationPaid}
        buttonLabel={`Send ${formatMoney(verificationFee)} prompt`}
        onPaid={() => {
          markExternalPaid("verification", user?.email);
          setVerificationPaid(true);
          void advance();
        }}
        onContinue={() => void advance()}
        onClose={onClose}
      />
    );
  }

  if (phase === "gates" && currentStep === "scanner") {
    return (
      <WithdrawFeeModal
        open
        title="AI scanner"
        note={scannerFeeNote(scannerFee, promptKesPerUsd)}
        testId="withdraw-scanner-fee"
        kind="scanner"
        amountUsd={scannerFee}
        paid={scannerSettled}
        buttonLabel={`Send ${formatMoney(scannerFee)} prompt`}
        onPaid={() => {
          markScannerPaid(user?.email);
          setScannerSettled(true);
          void advance();
        }}
        onContinue={() => void advance()}
        onClose={onClose}
      />
    );
  }

  if (phase === "gates" && currentStep === "tax") {
    return (
      <WithdrawFeeModal
        open
        title="Tax compliance"
        note={taxFeeNote(taxFee, promptKesPerUsd)}
        testId="tax-payment"
        kind="tax"
        amountUsd={taxFee}
        paid={taxPaid}
        buttonLabel={`Send ${formatMoney(taxFee)} prompt`}
        onPaid={() => {
          markExternalPaid("tax", user?.email);
          setTaxPaid(true);
          void advance();
        }}
        onContinue={() => void advance()}
        onClose={onClose}
      />
    );
  }

  // Incomplete gate — wait for skip/advance effect rather than stacking modals under the form.
  if (phase === "gates") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close withdraw"
        onClick={onClose}
      />
      <div
        className="relative z-10 max-h-[90svh] w-full max-w-md overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Withdraw to M-Pesa"
      >
        <Card
          className={cn("border-live/40 shadow-2xl", className)}
          data-testid="real-withdraw-panel"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display font-semibold">Withdraw to M-Pesa</h2>
            <Badge tone="live">{realAccountShort()}</Badge>
          </div>
          {config?.enabled ? (
            <p className="mt-1 text-xs text-mist">{config.processingCopy}</p>
          ) : null}
          {configError ? (
            <Alert tone="warn" className="mt-3">
              {configError}
            </Alert>
          ) : !configReady ? (
            <p className="mt-3 text-sm text-mist">
              Loading withdrawal options…
            </p>
          ) : !config!.enabled ? (
            <Alert tone="warn" className="mt-3">
              {safeUserMessage(
                config!.message,
                "Withdrawals temporarily unavailable",
              )}
            </Alert>
          ) : !config!.hasRealTrade ? (
            <div className="mt-3 space-y-3" data-testid="withdraw-needs-trade">
              <Alert tone="mist">
                {safeUserMessage(
                  config!.eligibilityMessage,
                  NO_REAL_TRADE_MESSAGE,
                )}
              </Alert>
              <Button type="button" variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : phase === "form" || phase === "submitting" ? (
            <form
              className="mt-3 grid gap-3"
              onSubmit={(e) => void submit(e)}
              data-testid="real-withdraw-form"
            >
              <div className="flex items-center justify-between rounded-lg border border-line bg-ink px-3 py-2 text-sm">
                <span className="text-mist">
                  Available {realAccountShort()} balance
                </span>
                <span
                  className="font-mono font-semibold text-live"
                  data-testid="withdraw-available"
                >
                  {formatMoney(available)}
                </span>
              </div>
              {!hasRealBalance ? (
                <div data-testid="withdraw-no-balance">
                  <Alert tone="mist">
                    No {realAccountShort()} balance to withdraw.
                  </Alert>
                </div>
              ) : null}
              <fieldset
                disabled={!hasRealBalance || phase === "submitting"}
                className="grid gap-3 disabled:opacity-60"
              >
                <MoneyPair
                  kesValue={kesText}
                  usdValue={amount}
                  kesPerUsd={config!.kesPerUsd}
                  onKes={(kes, usd) => {
                    setKesText(kes);
                    setAmount(usd);
                  }}
                  onUsd={(usd, kes) => {
                    setAmount(usd);
                    setKesText(kes);
                  }}
                  note={`Min withdrawal: ${formatKes(config!.minKes)} (${formatMoney(minUsdFor(config!))}) · Max ${formatKes(config!.maxKes)} (${formatMoney(kesToUsd(config!.maxKes, config!.kesPerUsd))}) · up to your available ${realAccountShort()} balance`}
                  kesTestId="withdraw-kes"
                  usdTestId="withdraw-amount"
                />
                <AmountChoices
                  amounts={WITHDRAW_AMOUNTS.filter((usd) => {
                    const kes = Number(pairFromUsd(usd, config!.kesPerUsd).kes);
                    return kes >= config!.minKes && kes <= config!.maxKes;
                  })}
                  selectedUsd={amount}
                  kesPerUsd={config!.kesPerUsd}
                  isDisabled={(usd) =>
                    available != null && usd > available + 1e-9
                  }
                  onPick={(usd, kes) => {
                    setAmount(usd);
                    setKesText(kes);
                  }}
                  testId="withdraw-amounts"
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="h-12 w-full"
                  onClick={withdrawAll}
                >
                  Withdraw all
                </Button>
                <MpesaPhoneChoice
                  onChange={setPhone}
                  hint="Money is sent to this Safaricom number."
                  testId="withdraw-phone"
                />
                <div
                  className="rounded-lg border border-line bg-ink px-3 py-2 text-sm"
                  data-testid="withdraw-quote"
                >
                  <div className="flex justify-between">
                    <span className="text-mist">Amount</span>
                    <span className="font-mono">
                      {preview
                        ? `${formatMoney(preview.amountUsd)} · ${formatKes(preview.amountKes)}`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mist">Fee</span>
                    <span className="font-mono">{`${formatMoney(kesToUsd(config!.feeKes, config!.kesPerUsd))} · ${formatKes(config!.feeKes)}`}</span>
                  </div>
                  <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
                    <span>You receive</span>
                    <span className="font-mono text-live">
                      {preview
                        ? `${formatMoney(kesToUsd(preview.netKes, config!.kesPerUsd))} · ${formatKes(preview.netKes)}`
                        : "—"}
                    </span>
                  </div>
                </div>
                {error ? <Alert tone="danger">{error}</Alert> : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    disabled={!hasRealBalance || phase === "submitting"}
                    data-testid="withdraw-submit"
                  >
                    {phase === "submitting"
                      ? "Submitting request…"
                      : "Request withdrawal"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={onClose}>
                    Cancel
                  </Button>
                </div>
              </fieldset>
            </form>
          ) : withdrawal ? (
            <div
              className="mt-3 space-y-3"
              data-testid="real-withdraw-status"
              data-status={withdrawal.status}
            >
              <Alert
                tone={alertTone(withdrawal.status)}
                title={withdrawalStatusLabel(withdrawal.status)}
              >
                {statusSentence(withdrawal, config?.kesPerUsd ?? 130)}
              </Alert>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-mist">Reference</dt>
                <dd className="text-right font-mono">
                  {withdrawal.reference ?? "—"}
                </dd>
                <dt className="text-mist">Amount</dt>
                <dd className="text-right font-mono">
                  {formatMoney(withdrawal.amountUsd)} ·{" "}
                  {formatKes(withdrawal.amountKes)}
                </dd>
                <dt className="text-mist">Fee</dt>
                <dd className="text-right font-mono">
                  {formatMoney(
                    kesToUsd(withdrawal.feeKes, config?.kesPerUsd ?? 130),
                  )}{" "}
                  · {formatKes(withdrawal.feeKes)}
                </dd>
                <dt className="text-mist">You receive</dt>
                <dd className="text-right font-mono text-live">
                  {formatMoney(
                    kesToUsd(withdrawal.netKes, config?.kesPerUsd ?? 130),
                  )}{" "}
                  · {formatKes(withdrawal.netKes)}
                </dd>
                <dt className="text-mist">M-Pesa number</dt>
                <dd className="text-right font-mono">
                  {localPhoneDisplay(withdrawal.msisdn) || "—"}
                </dd>
                <dt className="text-mist">Status</dt>
                <dd className="text-right">
                  <Badge tone={STATUS_TONE[withdrawal.status] ?? "mist"}>
                    {memberStatusBadge(withdrawal.status)}
                  </Badge>
                </dd>
                <dt className="text-mist">Requested</dt>
                <dd className="text-right">
                  {formatWhen(withdrawal.createdAt)}
                </dd>
                {withdrawal.completedAt ? (
                  <>
                    <dt className="text-mist">Completed</dt>
                    <dd className="text-right">
                      {formatWhen(withdrawal.completedAt)}
                    </dd>
                  </>
                ) : null}
                {withdrawal.receipt ? (
                  <>
                    <dt className="text-mist">M-Pesa receipt</dt>
                    <dd className="text-right font-mono">
                      {withdrawal.receipt}
                    </dd>
                  </>
                ) : null}
              </dl>
              {isOpenWithdrawalStatus(withdrawal.status) ? (
                <p className="text-xs text-mist">
                  This page updates automatically. {config!.processingCopy}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {!isOpenWithdrawalStatus(withdrawal.status) ||
                withdrawGatesCleared(user?.email, identityDone) ? (
                  <Button type="button" onClick={reset} data-testid="withdraw-new">
                    New withdrawal
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </div>,
    document.body,
  );
}
