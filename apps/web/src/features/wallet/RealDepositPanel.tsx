import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card } from "@/components/ui";
import {
  kesToUsd,
  normalizeKenyanPhone,
  validateAmountKes,
} from "@/domain/megapay";
import { cn } from "@/lib/cn";
import {
  AmountChoices,
  DEPOSIT_AMOUNTS,
} from "@/features/payments/AmountChoices";
import {
  MoneyPair,
  formatKes,
  pairFromKes,
  pairFromUsd,
} from "@/features/payments/MoneyPair";
import { MpesaPhoneChoice } from "@/features/payments/MpesaPhoneChoice";
import { formatMoney } from "@/lib/format";
import { notifyRealWalletChanged } from "@/lib/real-wallet-events";
import {
  depositMethodLabel,
  depositService,
  type DepositConfig,
  type DepositState,
} from "@/services/deposits";
import { realAccountShort } from "@/lib/branding";
import { safeUserMessage } from "@/lib/safe-user-message";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;
const PRESET_USD = DEPOSIT_AMOUNTS;

type Phase =
  | "form"
  | "submitting"
  | "waiting"
  | "completed"
  | "failed"
  | "timeout";

export function RealDepositPanel({
  onClose,
  className,
}: {
  onClose: () => void;
  className?: string;
}) {
  const [config, setConfig] = useState<DepositConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [kesText, setKesText] = useState("");
  const [usdText, setUsdText] = useState("");
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [deposit, setDeposit] = useState<DepositState | null>(null);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void depositService.getConfig().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setConfig(result.data);
        const next = pairFromKes(result.data.minKes, result.data.kesPerUsd);
        setKesText((current) => current || next.kes);
        setUsdText((current) => current || next.usd);
      } else
        setConfigError(
          safeUserMessage(result.error, "Deposits temporarily unavailable"),
        );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (pollTimer.current != null) window.clearTimeout(pollTimer.current);
    },
    [],
  );

  const amountKes = Math.round(Number(kesText));
  const amountUsd = Number(usdText);
  const minUsd = config ? kesToUsd(config.minKes, config.kesPerUsd) : 0;
  const maxUsd = config ? kesToUsd(config.maxKes, config.kesPerUsd) : 0;
  const presets = PRESET_USD.filter((usd) => {
    if (!config) return true;
    const kes = Number(pairFromUsd(usd, config.kesPerUsd).kes);
    return kes >= config.minKes && kes <= config.maxKes;
  });

  function poll(
    provider: DepositConfig["provider"],
    depositId: string,
    startedAt: number,
  ) {
    pollTimer.current = window.setTimeout(async () => {
      const result = await depositService.checkStatus(provider, depositId);
      if (result.ok) {
        setDeposit(result.data);
        if (result.data.status === "COMPLETED") {
          setPhase("completed");
          notifyRealWalletChanged();
          return;
        }
        if (
          result.data.status === "FAILED" ||
          result.data.status === "CANCELLED"
        ) {
          setPhase("failed");
          setError("Payment prompt failed. Contact support for assistance.");
          notifyRealWalletChanged();
          return;
        }
      }
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setPhase("timeout");
        notifyRealWalletChanged();
        return;
      }
      poll(provider, depositId, startedAt);
    }, POLL_INTERVAL_MS);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    if (
      !Number.isFinite(amountKes) ||
      amountKes <= 0 ||
      !Number.isFinite(amountUsd) ||
      amountUsd <= 0
    ) {
      setError("Enter an amount in KES or USD.");
      return;
    }
    if (amountKes < config.minKes) {
      setError(
        `Minimum deposit is ${formatKes(config.minKes)} (${formatMoney(minUsd)}).`,
      );
      return;
    }
    if (amountKes > config.maxKes) {
      setError(
        `Maximum deposit is ${formatKes(config.maxKes)} (${formatMoney(maxUsd)}).`,
      );
      return;
    }
    const validAmount = validateAmountKes(amountKes, config);
    if (!validAmount.ok) {
      setError(
        `Enter an amount from ${formatKes(config.minKes)} (${formatMoney(minUsd)}) to ${formatKes(config.maxKes)} (${formatMoney(maxUsd)}).`,
      );
      return;
    }
    const msisdn = normalizeKenyanPhone(phone);
    if (!msisdn) {
      setError("Enter a valid Safaricom M-Pesa number, e.g. 0712345678.");
      return;
    }
    setError(null);
    setPhase("submitting");
    const result = await depositService.startDeposit(
      config.provider,
      validAmount.amountKes,
      msisdn,
    );
    if (!result.ok) {
      setPhase("form");
      setError("Payment prompt failed. Contact support for assistance.");
      return;
    }
    setDeposit(result.data);
    setPhase("waiting");
    notifyRealWalletChanged();
    poll(config.provider, result.data.depositId, Date.now());
  }

  function reset() {
    if (pollTimer.current != null) window.clearTimeout(pollTimer.current);
    setPhase("form");
    setError(null);
    setDeposit(null);
  }

  return (
    <Card className={cn("border-live/40", className ?? "mt-4")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display font-semibold">Deposit with M-Pesa</h2>
        <Badge tone="live">{realAccountShort()}</Badge>
      </div>
      {config?.enabled ? (
        <p className="mt-1 text-xs text-mist">{depositMethodLabel(config)}</p>
      ) : null}

      {configError ? (
        <Alert tone="warn" className="mt-3">
          {configError}
        </Alert>
      ) : !config ? (
        <p className="mt-3 text-sm text-mist">Loading deposit options…</p>
      ) : !config.enabled ? (
        <Alert tone="warn" className="mt-3">
          {safeUserMessage(config.message, "Deposits temporarily unavailable")}
        </Alert>
      ) : phase === "form" || phase === "submitting" ? (
        <form className="mt-3 grid gap-3" onSubmit={(e) => void submit(e)}>
          <MoneyPair
            kesValue={kesText}
            usdValue={usdText}
            kesPerUsd={config.kesPerUsd}
            onKes={(kes, usd) => {
              setKesText(kes);
              setUsdText(usd);
            }}
            onUsd={(usd, kes) => {
              setUsdText(usd);
              setKesText(kes);
            }}
            note={`Min deposit: ${formatKes(config.minKes)} (${formatMoney(minUsd)}) · Max ${formatKes(config.maxKes)} (${formatMoney(maxUsd)})`}
            kesTestId="deposit-kes"
            usdTestId="deposit-usd"
          />
          <AmountChoices
            amounts={presets}
            selectedUsd={usdText}
            kesPerUsd={config.kesPerUsd}
            onPick={(usd, kes) => {
              setUsdText(usd);
              setKesText(kes);
            }}
            testId="deposit-amounts"
          />
          <MpesaPhoneChoice onChange={setPhone} testId="deposit-phone" />
          <p className="text-sm text-mist">
            <span className="font-semibold text-paper">
              {formatMoney(Number.isFinite(amountUsd) ? amountUsd : null)}
            </span>
            {Number.isFinite(amountKes) && amountKes > 0
              ? ` (${formatKes(amountKes)})`
              : ""}{" "}
            is added to your {realAccountShort()} balance. The phone prompt is
            the KES amount.
          </p>
          {error ? (
            <Alert
              tone="danger"
              title={
                error.toLowerCase().includes("prompt failed")
                  ? "Payment prompt failed"
                  : undefined
              }
            >
              {error}
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={phase === "submitting"}>
              {phase === "submitting" ? "Sending M-Pesa prompt…" : "Deposit"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 space-y-3">
          {phase === "waiting" ? (
            <Alert tone="signal" title="Payment prompt sent">
              Check your phone and enter your M-Pesa PIN to pay{" "}
              {formatMoney(deposit?.amountUsd ?? amountUsd)}
              {deposit?.amountKes
                ? ` (${formatKes(deposit.amountKes)})`
                : Number.isFinite(amountKes)
                  ? ` (${formatKes(amountKes)})`
                  : ""}
              .
            </Alert>
          ) : null}
          {phase === "completed" ? (
            <Alert tone="signal" title="Deposit received">
              {formatMoney(deposit?.amountUsd ?? amountUsd)} has been added to
              your {realAccountShort()} balance
              {deposit?.receipt ? ` (M-Pesa ${deposit.receipt})` : ""}.
            </Alert>
          ) : null}
          {phase === "failed" ? (
            <Alert tone="danger" title="Payment prompt failed">
              Payment prompt failed. Contact support for assistance.
            </Alert>
          ) : null}
          {phase === "timeout" ? (
            <Alert tone="warn" title="Still waiting for M-Pesa">
              We have not received a confirmation yet. If you completed the
              payment, your balance will update automatically once M-Pesa
              confirms it. Check the Deposits tab for the status.
            </Alert>
          ) : null}
          {deposit?.reference ? (
            <p className="text-xs text-mist">Reference: {deposit.reference}</p>
          ) : null}
          {phase !== "waiting" ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={reset}>
                New deposit
              </Button>
              <Button type="button" variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
