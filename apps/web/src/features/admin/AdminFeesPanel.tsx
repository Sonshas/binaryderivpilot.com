import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Card, Input } from "@/components/ui";
import type {
  DepositFeeSettings,
  TradingFeeSettings,
  WithdrawalFeeSettings,
} from "@/domain/payment-settings";
import { DEFAULT_TRADE_PAYOUT_PERCENT } from "@/domain/payment-settings";
import { kesToUsd } from "@/domain/megapay";
import { usdToKes } from "@/domain/withdrawals";
import {
  DEPOSIT_KES_PER_USD,
  WITHDRAW_KES_PER_USD,
  adminFeesService,
} from "@/services/admin-fees";
import { realAccountShort } from "@/lib/branding";

function numInput(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function usdText(kes: number, rate: number): string {
  return kesToUsd(kes, rate > 0 ? rate : 130).toFixed(2);
}

function usdList(raw: string, rate: number): string {
  return raw
    .split(",")
    .map((part) => {
      const n = Number(part.trim());
      return Number.isFinite(n) ? usdText(n, rate) : part.trim();
    })
    .filter(Boolean)
    .join(", ");
}

function kesList(raw: string, rate: number): string {
  return raw
    .split(",")
    .map((part) => {
      const n = Number(part.trim());
      return Number.isFinite(n)
        ? String(usdToKes(n, rate > 0 ? rate : 130))
        : "";
    })
    .filter(Boolean)
    .join(",");
}

function Field({
  label,
  hint,
  value,
  onChange,
  step = "1",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
}) {
  return (
    <Input
      label={label}
      hint={hint}
      type="number"
      step={step}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function AdminFeesPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [deposit, setDeposit] = useState<DepositFeeSettings>({
    kesPerUsd: DEPOSIT_KES_PER_USD,
    minKes: 1600,
    maxKes: 150_000,
    quickAmounts: "1600,2500,5000,10000",
  });
  const [withdrawal, setWithdrawal] = useState<WithdrawalFeeSettings>({
    kesPerUsd: WITHDRAW_KES_PER_USD,
    minKes: 1000,
    maxKes: 400_000,
    feeKes: 0,
  });
  // Preserved on Fees save — edited under Trade settings.
  const [trading, setTrading] = useState<TradingFeeSettings>({
    stakeMinUsd: 1,
    stakeMaxUsd: 500,
    maxOpenTrades: 5,
    dailyProfitLimitUsd: 1000,
    payoutPercent: DEFAULT_TRADE_PAYOUT_PERCENT,
  });

  useEffect(() => {
    let cancelled = false;
    void adminFeesService.load().then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDeposit(result.data.host.deposit);
      setWithdrawal(result.data.host.withdrawal);
      setTrading(result.data.host.trading);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    const result = await adminFeesService.save({
      deposit: {
        ...deposit,
        kesPerUsd: numInput(String(deposit.kesPerUsd), deposit.kesPerUsd),
        minKes: Math.round(numInput(String(deposit.minKes), deposit.minKes)),
        maxKes: Math.round(numInput(String(deposit.maxKes), deposit.maxKes)),
      },
      withdrawal: {
        ...withdrawal,
        kesPerUsd: numInput(String(withdrawal.kesPerUsd), withdrawal.kesPerUsd),
        minKes: Math.round(
          numInput(String(withdrawal.minKes), withdrawal.minKes),
        ),
        maxKes: Math.round(
          numInput(String(withdrawal.maxKes), withdrawal.maxKes),
        ),
        feeKes: Math.round(
          numInput(String(withdrawal.feeKes), withdrawal.feeKes),
        ),
      },
      trading,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDeposit(result.data.host.deposit);
    setWithdrawal(result.data.host.withdrawal);
    setTrading(result.data.host.trading);
    setMessage(result.data.message);
  }

  if (loading) return <p className="text-sm text-mist">Loading fees…</p>;

  return (
    <form className="space-y-4" onSubmit={onSave} data-testid="admin-fees-form">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="signal">{message}</Alert> : null}

      <Card className="space-y-3">
        <div>
          <p className="font-semibold text-paper">Wallet dollar rates</p>
          <p className="text-sm text-mist">
            KES per $1 for wallet top-ups and cash-out payouts only. Scanner,
            verification, and tax prompt rates are set under Withdrawal controls
            — saving here does not change those. Stake limits and trade payout
            are under Trade settings.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Deposit rate"
            hint="Wallet top-up conversion. Starts at 134."
            step="0.0001"
            value={String(deposit.kesPerUsd)}
            onChange={(v) =>
              setDeposit((d) => ({ ...d, kesPerUsd: numInput(v, d.kesPerUsd) }))
            }
          />
          <Field
            label="Payout rate"
            hint="Cash-out conversion to M-Pesa. Starts at 125."
            step="0.0001"
            value={String(withdrawal.kesPerUsd)}
            onChange={(v) =>
              setWithdrawal((w) => ({
                ...w,
                kesPerUsd: numInput(v, w.kesPerUsd),
              }))
            }
          />
        </div>
      </Card>

      <Card className="space-y-3">
        <div>
          <p className="font-semibold text-paper">Account deposits (M-Pesa)</p>
          <p className="text-sm text-mist">
            Limits used when a member tops up the {realAccountShort()} wallet.
            Amounts follow the deposit rate.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="Min deposit (USD)"
            step="0.01"
            value={usdText(deposit.minKes, deposit.kesPerUsd)}
            onChange={(v) =>
              setDeposit((d) => ({
                ...d,
                minKes: usdToKes(
                  numInput(v, kesToUsd(d.minKes, d.kesPerUsd)),
                  d.kesPerUsd,
                ),
              }))
            }
          />
          <Field
            label="Max deposit (USD)"
            step="0.01"
            value={usdText(deposit.maxKes, deposit.kesPerUsd)}
            onChange={(v) =>
              setDeposit((d) => ({
                ...d,
                maxKes: usdToKes(
                  numInput(v, kesToUsd(d.maxKes, d.kesPerUsd)),
                  d.kesPerUsd,
                ),
              }))
            }
          />
          <Input
            label="Quick amounts (USD)"
            hint="Comma-separated, e.g. 12.31, 19.23, 38.46"
            value={usdList(deposit.quickAmounts, deposit.kesPerUsd)}
            onChange={(e) =>
              setDeposit((d) => ({
                ...d,
                quickAmounts: kesList(e.target.value, d.kesPerUsd),
              }))
            }
          />
        </div>
      </Card>

      <Card className="space-y-3">
        <div>
          <p className="font-semibold text-paper">
            {realAccountShort()} cash-out limits
          </p>
          <p className="text-sm text-mist">
            Min/max and payout fee for the wallet withdrawal itself. Not the
            scanner, verification, or tax M-Pesa prompts (those are Withdrawal
            controls).
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Min withdrawal (USD)"
            step="0.01"
            value={usdText(withdrawal.minKes, withdrawal.kesPerUsd)}
            onChange={(v) =>
              setWithdrawal((w) => ({
                ...w,
                minKes: usdToKes(
                  numInput(v, kesToUsd(w.minKes, w.kesPerUsd)),
                  w.kesPerUsd,
                ),
              }))
            }
          />
          <Field
            label="Max withdrawal (USD)"
            step="0.01"
            value={usdText(withdrawal.maxKes, withdrawal.kesPerUsd)}
            hint="Hard-capped at KES 400,000"
            onChange={(v) =>
              setWithdrawal((w) => ({
                ...w,
                maxKes: usdToKes(
                  numInput(v, kesToUsd(w.maxKes, w.kesPerUsd)),
                  w.kesPerUsd,
                ),
              }))
            }
          />
          <Field
            label="Payout fee (USD)"
            step="0.01"
            value={usdText(withdrawal.feeKes, withdrawal.kesPerUsd)}
            hint="Deducted from the wallet payout before M-Pesa send — not a gate STK"
            onChange={(v) =>
              setWithdrawal((w) => ({
                ...w,
                feeKes: usdToKes(
                  numInput(v, kesToUsd(w.feeKes, w.kesPerUsd)),
                  w.kesPerUsd,
                ),
              }))
            }
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving} data-testid="admin-fees-save">
          {saving ? "Saving…" : "Save wallet fees"}
        </Button>
        <p className="text-xs text-mist">
          Stake limits, trade payout, and win rates are under Trade settings.
        </p>
      </div>
    </form>
  );
}
