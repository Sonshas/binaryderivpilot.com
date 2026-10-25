import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { REAL_TRADE_SYMBOLS } from "@/domain/digit-contracts";
import {
  clearUserTrades,
  countUserTrades,
  placeUserTrade,
} from "@/lib/admin-user-trades";
import { demoAccountShort, realAccountShort } from "@/lib/branding";
import { getMarketDataProvider } from "@/services/market-data";
import type { AccountMode } from "@/types";

const fieldClass =
  "h-11 w-full rounded-xl border border-line bg-ink-2 px-3 text-paper outline-none focus:border-signal focus:ring-2 focus:ring-signal/25";

export function UserTradesCard({
  email,
  onChanged,
}: {
  email: string;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<AccountMode>("demo");
  const [symbol, setSymbol] = useState<string>(
    REAL_TRADE_SYMBOLS[4] ?? "R_100",
  );
  const [side, setSide] = useState<"even" | "odd">("even");
  const [stake, setStake] = useState("1");
  const [ticks, setTicks] = useState("5");
  const [notice, setNotice] = useState("");
  const demoCount = countUserTrades(email, "demo");
  const realCount = countUserTrades(email, "real");

  useEffect(() => {
    return getMarketDataProvider("real").subscribeTicks(
      symbol,
      () => undefined,
    );
  }, [symbol]);

  function refresh(message: string) {
    setNotice(message);
    onChanged();
  }

  function place() {
    const result = placeUserTrade(email, mode, {
      symbol,
      contractOption: side,
      stake: Number(stake),
      durationTicks: Number(ticks),
    });
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    refresh(`Placed ${side} on ${symbol} for ${email} ${mode} account.`);
  }

  function clear(target: AccountMode) {
    const removed = clearUserTrades(email, target);
    refresh(
      removed === 0
        ? `${email} has no ${target} trades.`
        : `Deleted ${removed} ${target} trade${removed === 1 ? "" : "s"} for ${email}.`,
    );
  }

  return (
    <Card className="mt-3 space-y-3" data-testid="user-trades">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-paper">Trades</p>
          <p className="text-xs text-mist">
            <span data-testid="user-demo-trade-count">{demoCount}</span>{" "}
            {demoAccountShort().toLowerCase()} ·{" "}
            <span data-testid="user-real-trade-count">{realCount}</span>{" "}
            {realAccountShort().toLowerCase()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => clear("demo")}
            data-testid="user-delete-demo-trades"
          >
            Delete {demoAccountShort().toLowerCase()} trade history
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => clear("real")}
            data-testid="user-delete-real-trades"
          >
            Delete {realAccountShort().toLowerCase()} trade history
          </Button>
        </div>
      </div>
      {notice ? <p className="text-sm text-signal">{notice}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-paper">Account</span>
          <select
            className={fieldClass}
            value={mode}
            onChange={(event) => setMode(event.target.value as AccountMode)}
            data-testid="user-trade-mode"
          >
            <option value="demo">{demoAccountShort()}</option>
            <option value="real">{realAccountShort()}</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-paper">Market</span>
          <select
            className={fieldClass}
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            data-testid="user-trade-symbol"
          >
            {REAL_TRADE_SYMBOLS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-paper">Side</span>
          <select
            className={fieldClass}
            value={side}
            onChange={(event) => setSide(event.target.value as "even" | "odd")}
            data-testid="user-trade-side"
          >
            <option value="even">Even</option>
            <option value="odd">Odd</option>
          </select>
        </label>
        <Input
          label="Stake (USD)"
          type="number"
          min={0.01}
          step="0.01"
          value={stake}
          onChange={(event) => setStake(event.target.value)}
          data-testid="user-trade-stake"
        />
        <Input
          label="Ticks"
          type="number"
          min={1}
          max={10}
          step={1}
          value={ticks}
          onChange={(event) => setTicks(event.target.value)}
          data-testid="user-trade-ticks"
        />
      </div>
      <Button type="button" onClick={place} data-testid="user-place-trade">
        Place trade
      </Button>
      <p className="text-xs text-mist">
        The trade opens on the live price and settles on the exit digit.
        Deleting history returns any open stake to that account.
      </p>
    </Card>
  );
}
