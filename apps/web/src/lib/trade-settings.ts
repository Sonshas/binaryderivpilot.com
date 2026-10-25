import {
  STANDARD_PAYOUT_RATE,
  contractCanWin,
  payoutFor,
  type DigitContractSelection,
} from "@/domain/digit-contracts";
import {
  DEFAULT_WIN_RATE_PERCENT as OUTCOME_DEFAULT_WIN_RATE,
  clampWinRatePercent,
} from "@/domain/outcome/win-rate";

const KEY = "sbb.admin.trade";

export const DEFAULT_PAYOUT_PERCENT =
  Math.round(STANDARD_PAYOUT_RATE * 10000) / 100;
export const DEFAULT_WIN_RATE_PERCENT = OUTCOME_DEFAULT_WIN_RATE;
export const PAYOUT_EXAMPLE_STAKE = 10;

/** Keys stored in public.trading_settings (numeric value). */
export const TRADE_OUTCOME_KEYS = {
  payoutPercent: "TRADE_PAYOUT_PERCENT",
  demoWinRatePercent: "DEMO_WIN_RATE_PERCENT",
  realWinRatePercent: "REAL_WIN_RATE_PERCENT",
  vipWinRatePercent: "VIP_WIN_RATE_PERCENT",
  scannerWinRatePercent: "SCANNER_WIN_RATE_PERCENT",
} as const;

export interface TradeSettings {
  payoutPercent: number;
  demoWinRatePercent: number;
  realWinRatePercent: number;
  vipWinRatePercent: number;
  scannerWinRatePercent: number;
}

export type TradeWinRateMode = "demo" | "real" | "vip" | "scanner";

type StoredTradeSettings = Partial<TradeSettings> & { winRatePercent?: number };

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function clampPercent(value: unknown, fallback: number, max: number): number {
  const amount = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 0 || amount > max) return fallback;
  return amount;
}

function defaults(): TradeSettings {
  return {
    payoutPercent: DEFAULT_PAYOUT_PERCENT,
    demoWinRatePercent: DEFAULT_WIN_RATE_PERCENT,
    realWinRatePercent: DEFAULT_WIN_RATE_PERCENT,
    vipWinRatePercent: DEFAULT_WIN_RATE_PERCENT,
    scannerWinRatePercent: DEFAULT_WIN_RATE_PERCENT,
  };
}

function normalize(
  parsed: StoredTradeSettings | null | undefined,
): TradeSettings {
  const base = defaults();
  if (!parsed || typeof parsed !== "object") return base;
  const legacy = clampWinRatePercent(
    parsed.winRatePercent,
    DEFAULT_WIN_RATE_PERCENT,
  );
  const legacyUsed =
    parsed.winRatePercent != null &&
    Number.isFinite(Number(parsed.winRatePercent));
  return {
    payoutPercent: clampPercent(
      parsed.payoutPercent,
      DEFAULT_PAYOUT_PERCENT,
      500,
    ),
    demoWinRatePercent: clampWinRatePercent(
      parsed.demoWinRatePercent,
      legacyUsed ? legacy : DEFAULT_WIN_RATE_PERCENT,
    ),
    realWinRatePercent: clampWinRatePercent(
      parsed.realWinRatePercent,
      legacyUsed ? legacy : DEFAULT_WIN_RATE_PERCENT,
    ),
    vipWinRatePercent: clampWinRatePercent(
      parsed.vipWinRatePercent,
      legacyUsed ? legacy : DEFAULT_WIN_RATE_PERCENT,
    ),
    scannerWinRatePercent: clampWinRatePercent(
      parsed.scannerWinRatePercent,
      legacyUsed ? legacy : DEFAULT_WIN_RATE_PERCENT,
    ),
  };
}

function readRaw(): TradeSettings {
  if (!canUseStorage()) return defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    return normalize(JSON.parse(raw) as StoredTradeSettings);
  } catch {
    return defaults();
  }
}

export function readTradeSettings(): TradeSettings {
  return readRaw();
}

export function saveTradeSettings(next: Partial<TradeSettings>): TradeSettings {
  const current = readRaw();
  const saved: TradeSettings = {
    payoutPercent: clampPercent(
      next.payoutPercent ?? current.payoutPercent,
      DEFAULT_PAYOUT_PERCENT,
      500,
    ),
    demoWinRatePercent: clampWinRatePercent(
      next.demoWinRatePercent ?? current.demoWinRatePercent,
    ),
    realWinRatePercent: clampWinRatePercent(
      next.realWinRatePercent ?? current.realWinRatePercent,
    ),
    vipWinRatePercent: clampWinRatePercent(
      next.vipWinRatePercent ?? current.vipWinRatePercent,
    ),
    scannerWinRatePercent: clampWinRatePercent(
      next.scannerWinRatePercent ?? current.scannerWinRatePercent,
    ),
  };
  if (canUseStorage()) localStorage.setItem(KEY, JSON.stringify(saved));
  return saved;
}

export function winRatePercentForMode(
  mode: TradeWinRateMode,
  settings: TradeSettings = readTradeSettings(),
): number {
  if (mode === "demo") return settings.demoWinRatePercent;
  if (mode === "vip") return settings.vipWinRatePercent;
  if (mode === "scanner") return settings.scannerWinRatePercent;
  return settings.realWinRatePercent;
}

export function quotedProfitRate(selection: DigitContractSelection): number {
  if (!contractCanWin(selection)) return 0;
  return readTradeSettings().payoutPercent / 100;
}

export function quotedPayout(
  stake: number,
  selection: DigitContractSelection,
): number {
  return payoutFor(stake, quotedProfitRate(selection), "won");
}

export function payoutAmountForExample(
  payoutPercent: number,
  stake = PAYOUT_EXAMPLE_STAKE,
): number {
  return payoutFor(stake, payoutPercent / 100, "won");
}

export function percentFromExampleAmount(
  amount: number,
  stake = PAYOUT_EXAMPLE_STAKE,
): number {
  if (!Number.isFinite(amount) || !Number.isFinite(stake) || stake <= 0)
    return DEFAULT_PAYOUT_PERCENT;
  return Math.round((amount / stake - 1) * 10000) / 100;
}

export function tradeOutcomeRowsFromSettings(settings: TradeSettings): Array<{
  key: string;
  value: number;
  description: string;
}> {
  return [
    {
      key: TRADE_OUTCOME_KEYS.payoutPercent,
      value: settings.payoutPercent,
      description:
        "Profit percent added to stake when a contract wins (admin Fees).",
    },
    {
      key: TRADE_OUTCOME_KEYS.demoWinRatePercent,
      value: settings.demoWinRatePercent,
      description:
        "Demo account settlement win rate percent (digits 0..n-1 win).",
    },
    {
      key: TRADE_OUTCOME_KEYS.realWinRatePercent,
      value: settings.realWinRatePercent,
      description:
        "Real account settlement win rate percent (digits 0..n-1 win).",
    },
    {
      key: TRADE_OUTCOME_KEYS.vipWinRatePercent,
      value: settings.vipWinRatePercent,
      description: "VIP settlement win rate percent (digits 0..n-1 win).",
    },
    {
      key: TRADE_OUTCOME_KEYS.scannerWinRatePercent,
      value: settings.scannerWinRatePercent,
      description:
        "AI scanner settlement win rate percent (digits 0..n-1 win).",
    },
  ];
}
