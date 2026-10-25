import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Card, Input, PageHeader } from "@/components/ui";
import type { TradingFeeSettings } from "@/domain/payment-settings";
import { DEFAULT_TRADE_PAYOUT_PERCENT } from "@/domain/payment-settings";
import { demoAccountShort, realAccountShort } from "@/lib/branding";
import { formatMoney } from "@/lib/format";
import {
  DEFAULT_WIN_RATE_PERCENT,
  PAYOUT_EXAMPLE_STAKE,
  payoutAmountForExample,
  percentFromExampleAmount,
  readTradeSettings,
} from "@/lib/trade-settings";
import { adminFeesService } from "@/services/admin-fees";
import { adminTradeSettingsService } from "@/services/admin-trade-settings";

function num(value: string, fallback: number): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : fallback;
}

export function AdminTradeSettingsPage() {
  const saved = readTradeSettings();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [trading, setTrading] = useState<TradingFeeSettings>({
    stakeMinUsd: 1,
    stakeMaxUsd: 500,
    maxOpenTrades: 5,
    dailyProfitLimitUsd: 1000,
    payoutPercent: saved.payoutPercent || DEFAULT_TRADE_PAYOUT_PERCENT,
  });
  const [payoutAmount, setPayoutAmount] = useState(
    payoutAmountForExample(saved.payoutPercent || DEFAULT_TRADE_PAYOUT_PERCENT).toFixed(2),
  );
  const [demoWinRatePercent, setDemoWinRatePercent] = useState(
    String(saved.demoWinRatePercent),
  );
  const [realWinRatePercent, setRealWinRatePercent] = useState(
    String(saved.realWinRatePercent),
  );
  const [vipWinRatePercent, setVipWinRatePercent] = useState(
    String(saved.vipWinRatePercent),
  );
  const [scannerWinRatePercent, setScannerWinRatePercent] = useState(
    String(saved.scannerWinRatePercent),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [fees, outcomes] = await Promise.all([
        adminFeesService.load(),
        adminTradeSettingsService.load(),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (!fees.ok) {
        setError(fees.error);
        return;
      }
      setTrading(fees.data.host.trading);
      setPayoutAmount(
        payoutAmountForExample(fees.data.host.trading.payoutPercent).toFixed(2),
      );
      if (outcomes.ok) {
        setDemoWinRatePercent(String(outcomes.data.demoWinRatePercent));
        setRealWinRatePercent(String(outcomes.data.realWinRatePercent));
        setVipWinRatePercent(String(outcomes.data.vipWinRatePercent));
        setScannerWinRatePercent(String(outcomes.data.scannerWinRatePercent));
        if (outcomes.data.payoutPercent > 0) {
          setTrading((t) => ({ ...t, payoutPercent: outcomes.data.payoutPercent }));
          setPayoutAmount(payoutAmountForExample(outcomes.data.payoutPercent).toFixed(2));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function onPayoutPercent(value: string) {
    const percent = num(value, DEFAULT_TRADE_PAYOUT_PERCENT);
    setTrading((t) => ({ ...t, payoutPercent: percent }));
    setPayoutAmount(payoutAmountForExample(percent).toFixed(2));
  }

  function onPayoutAmount(value: string) {
    setPayoutAmount(value);
    const amount = num(value, payoutAmountForExample(DEFAULT_TRADE_PAYOUT_PERCENT));
    setTrading((t) => ({
      ...t,
      payoutPercent: percentFromExampleAmount(amount),
    }));
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError(null);

    const nextTrading: TradingFeeSettings = {
      stakeMinUsd: num(String(trading.stakeMinUsd), trading.stakeMinUsd),
      stakeMaxUsd: num(String(trading.stakeMaxUsd), trading.stakeMaxUsd),
      maxOpenTrades: Math.round(num(String(trading.maxOpenTrades), trading.maxOpenTrades)),
      dailyProfitLimitUsd: num(
        String(trading.dailyProfitLimitUsd),
        trading.dailyProfitLimitUsd,
      ),
      payoutPercent: num(String(trading.payoutPercent), trading.payoutPercent),
    };

    const feesLoaded = await adminFeesService.load();
    if (!feesLoaded.ok) {
      setSaving(false);
      setError(feesLoaded.error);
      return;
    }

    const feesSaved = await adminFeesService.save({
      deposit: feesLoaded.data.host.deposit,
      withdrawal: feesLoaded.data.host.withdrawal,
      trading: nextTrading,
    });
    if (!feesSaved.ok) {
      setSaving(false);
      setError(feesSaved.error);
      return;
    }

    const outcomes = await adminTradeSettingsService.save({
      payoutPercent: nextTrading.payoutPercent,
      demoWinRatePercent: num(demoWinRatePercent, DEFAULT_WIN_RATE_PERCENT),
      realWinRatePercent: num(realWinRatePercent, DEFAULT_WIN_RATE_PERCENT),
      vipWinRatePercent: num(vipWinRatePercent, DEFAULT_WIN_RATE_PERCENT),
      scannerWinRatePercent: num(scannerWinRatePercent, DEFAULT_WIN_RATE_PERCENT),
    });
    setSaving(false);
    if (!outcomes.ok) {
      setError(outcomes.error);
      return;
    }

    setTrading(feesSaved.data.host.trading);
    setPayoutAmount(
      payoutAmountForExample(feesSaved.data.host.trading.payoutPercent).toFixed(2),
    );
    setDemoWinRatePercent(String(outcomes.data.demoWinRatePercent));
    setRealWinRatePercent(String(outcomes.data.realWinRatePercent));
    setVipWinRatePercent(String(outcomes.data.vipWinRatePercent));
    setScannerWinRatePercent(String(outcomes.data.scannerWinRatePercent));
    setMessage(
      `Trade settings saved. Win rates — ${demoAccountShort().toLowerCase()} ${outcomes.data.demoWinRatePercent.toFixed(2)}%, ${realAccountShort().toLowerCase()} ${outcomes.data.realWinRatePercent.toFixed(2)}%, VIP ${outcomes.data.vipWinRatePercent.toFixed(2)}%, scanner ${outcomes.data.scannerWinRatePercent.toFixed(2)}%. Payout ${nextTrading.payoutPercent.toFixed(2)}%.`,
    );
  }

  if (loading) return <p className="text-sm text-mist">Loading trade settings…</p>;

  return (
    <form className="space-y-4" onSubmit={onSave} data-testid="admin-trade-settings">
      <PageHeader
        title="Trade settings"
        subtitle={`Stake limits, payout, and win rates for ${demoAccountShort()} / ${realAccountShort()} settlement. Wallet rates stay under Fees.`}
        actions={
          <Button type="submit" disabled={saving} data-testid="trade-settings-save">
            {saving ? "Saving…" : "Save"}
          </Button>
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? <Alert tone="signal">{message}</Alert> : null}

      <Card className="space-y-3">
        <div>
          <p className="font-semibold text-paper">{realAccountShort()} trading limits</p>
          <p className="text-sm text-mist">
            Stake bounds, open-trade cap, and daily net profit pause.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Min stake (USD)"
            type="number"
            step="0.01"
            value={String(trading.stakeMinUsd)}
            onChange={(e) =>
              setTrading((t) => ({ ...t, stakeMinUsd: num(e.target.value, t.stakeMinUsd) }))
            }
            data-testid="trade-stake-min"
          />
          <Input
            label="Max stake (USD)"
            type="number"
            step="0.01"
            value={String(trading.stakeMaxUsd)}
            onChange={(e) =>
              setTrading((t) => ({ ...t, stakeMaxUsd: num(e.target.value, t.stakeMaxUsd) }))
            }
            data-testid="trade-stake-max"
          />
          <Input
            label="Max open trades"
            type="number"
            value={String(trading.maxOpenTrades)}
            onChange={(e) =>
              setTrading((t) => ({
                ...t,
                maxOpenTrades: num(e.target.value, t.maxOpenTrades),
              }))
            }
            data-testid="trade-max-open"
          />
          <Input
            label="Daily profit limit (USD)"
            type="number"
            step="0.01"
            value={String(trading.dailyProfitLimitUsd)}
            onChange={(e) =>
              setTrading((t) => ({
                ...t,
                dailyProfitLimitUsd: num(e.target.value, t.dailyProfitLimitUsd),
              }))
            }
            data-testid="trade-daily-profit-limit"
          />
        </div>
      </Card>

      <Card className="space-y-3">
        <div>
          <p className="font-semibold text-paper">Trade payout</p>
          <p className="text-sm text-mist">
            Profit added to the stake when a contract wins. Over 9 and under 0 still return
            nothing. New trades use the percentage saved here.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Payout percentage"
            hint="95.22 means a win returns the stake plus 95.22%."
            type="number"
            min={0}
            max={500}
            step="0.01"
            value={String(trading.payoutPercent)}
            onChange={(e) => onPayoutPercent(e.target.value)}
            data-testid="trade-payout-percent"
          />
          <Input
            label={`Payout on a ${formatMoney(PAYOUT_EXAMPLE_STAKE)} win (USD)`}
            hint="Editing this updates the percentage."
            type="number"
            min={0}
            step="0.01"
            value={payoutAmount}
            onChange={(e) => onPayoutAmount(e.target.value)}
            data-testid="trade-payout-amount"
          />
        </div>
      </Card>

      <Card className="space-y-3">
        <div>
          <p className="font-semibold text-paper">Win rates</p>
          <p className="text-sm text-mist">
            Settlement follows these percents only (no even/odd/match natural odds). At 90%,
            digits 0–8 win and 9 loses. At 80%, digits 0–7 win. Contract side is for the ticket
            display.
          </p>
        </div>
        <Input
          label={`${demoAccountShort()} win rate (%)`}
          hint="Applied when Demo trades settle."
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={demoWinRatePercent}
          onChange={(event) => setDemoWinRatePercent(event.target.value)}
          data-testid="trade-win-rate-demo"
        />
        <Input
          label={`${realAccountShort()} win rate (%)`}
          hint="Applied when Real trades settle."
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={realWinRatePercent}
          onChange={(event) => setRealWinRatePercent(event.target.value)}
          data-testid="trade-win-rate-real"
        />
        <Input
          label="VIP win rate (%)"
          hint="Applied for VIP settlement."
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={vipWinRatePercent}
          onChange={(event) => setVipWinRatePercent(event.target.value)}
          data-testid="trade-win-rate-vip"
        />
        <Input
          label="AI scanner win rate (%)"
          hint="Applied for scanner-driven trades."
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={scannerWinRatePercent}
          onChange={(event) => setScannerWinRatePercent(event.target.value)}
          data-testid="trade-win-rate-scanner"
        />
      </Card>
    </form>
  );
}
