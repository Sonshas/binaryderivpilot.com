import {
  calculateAccountTradeResult,
  settleDigitContract as settleViaOutcome,
} from "./outcome/settle.ts";
import {
  DEFAULT_WIN_RATE_PERCENT,
  winningDigitCountForPercent,
} from "./outcome/win-rate.ts";
import { realAccountName, realAccountShort } from "./branding.ts";

export type DigitContractType = "EVEN_ODD" | "MATCH_DIFFER" | "OVER_UNDER";
export type DigitContractOption =
  | "even"
  | "odd"
  | "match"
  | "differ"
  | "over"
  | "under";
export type DigitOutcome = "won" | "lost" | "tie";

export const DIGIT_CONTRACT_OPTIONS: Record<
  DigitContractType,
  DigitContractOption[]
> = {
  EVEN_ODD: ["even", "odd"],
  MATCH_DIFFER: ["match", "differ"],
  OVER_UNDER: ["over", "under"],
};

export const HOUSE_MARGIN = 0.05;
export const MAX_PAYOUT_RATE = 8.5;
export const CANNOT_WIN_WARNING = "This contract cannot win — 0% chance";

export interface DigitContractSelection {
  contractType: DigitContractType;
  contractOption: DigitContractOption;
  selectedDigit: number | null;
  barrier: number | null;
}

export function winningDigitCount(
  selection: DigitContractSelection,
  winRatePercent: number = DEFAULT_WIN_RATE_PERCENT,
): number {
  const n = winningDigitCountForPercent(winRatePercent);
  if (selection.contractType === "EVEN_ODD") {
    return selection.contractOption === "even" ||
      selection.contractOption === "odd"
      ? n
      : 0;
  }
  if (selection.contractType === "MATCH_DIFFER") {
    if (
      selection.contractOption !== "match" &&
      selection.contractOption !== "differ"
    )
      return 0;
    if (
      !Number.isInteger(selection.selectedDigit) ||
      selection.selectedDigit! < 0 ||
      selection.selectedDigit! > 9
    )
      return 0;
    return n;
  }
  if (selection.contractType === "OVER_UNDER") {
    const barrier = selection.barrier;
    if (
      typeof barrier !== "number" ||
      !Number.isInteger(barrier) ||
      barrier < 0 ||
      barrier > 9
    )
      return 0;
    if (selection.contractOption === "over" && barrier === 9) return 0;
    if (selection.contractOption === "under" && barrier === 0) return 0;
    if (
      selection.contractOption !== "over" &&
      selection.contractOption !== "under"
    )
      return 0;
    return n;
  }
  return 0;
}

export function contractCanWin(selection: DigitContractSelection): boolean {
  return winningDigitCount(selection) > 0;
}

export const STANDARD_PAYOUT_RATE = 0.9522;

export function digitPayoutRate(selection: DigitContractSelection): number {
  if (winningDigitCount(selection) <= 0) return 0;
  return STANDARD_PAYOUT_RATE;
}

export const TRADE_DURATIONS = [
  { label: "15s", ms: 15_000 },
  { label: "30s", ms: 30_000 },
  { label: "1m", ms: 60_000 },
  { label: "2m", ms: 120_000 },
  { label: "5m", ms: 300_000 },
] as const;

export const TICK_DURATION_MIN = 1;
export const TICK_DURATION_MAX = 10;
export const TICK_DURATION_DEFAULT = 5;

export function isValidTickDuration(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= TICK_DURATION_MIN &&
    value <= TICK_DURATION_MAX
  );
}

export function nominalTickIntervalMs(symbol: string): number | null {
  if (/^1HZ\d+V$/.test(symbol)) return 1_000;
  if (/^R_\d+$/.test(symbol)) return 2_000;
  return null;
}

export function tickAnchorMs(entryEpochMs: number, placedAtMs: number): number {
  return Math.max(entryEpochMs, Math.floor(placedAtMs / 1000) * 1000);
}

export function estimatedTickExpiryMs(
  anchorMs: number,
  ticks: number,
  symbol: string,
): number {
  return anchorMs + ticks * (nominalTickIntervalMs(symbol) ?? 2_000);
}

export function selectNthTickAfter<T extends PriceTick>(
  ticks: readonly T[],
  anchorMs: number,
  n: number,
): { exit: T; epochsMs: number[] } | null {
  if (!Number.isInteger(n) || n < 1 || !Number.isFinite(anchorMs)) return null;
  const byEpoch = new Map<number, T>();
  for (const tick of ticks) {
    if (
      !Number.isFinite(tick.epochMs) ||
      !Number.isFinite(tick.price) ||
      tick.epochMs <= anchorMs
    )
      continue;
    if (!byEpoch.has(tick.epochMs)) byEpoch.set(tick.epochMs, tick);
  }
  if (byEpoch.size < n) return null;
  const epochsMs = [...byEpoch.keys()].sort((a, b) => a - b).slice(0, n);
  return { exit: byEpoch.get(epochsMs[n - 1]!)!, epochsMs };
}

export const REAL_TRADE_SYMBOLS = [
  "R_10",
  "R_25",
  "R_50",
  "R_75",
  "R_100",
  "1HZ10V",
  "1HZ25V",
  "1HZ50V",
  "1HZ75V",
  "1HZ100V",
] as const;

export const REAL_STAKE_MIN = 1;
export const REAL_STAKE_MAX = 500;
export const REAL_MAX_OPEN_TRADES = 5;
export const REAL_DAILY_PROFIT_LIMIT_USD = 1000;
export const REAL_DAILY_LIMIT_TIMEZONE = "Africa/Nairobi";
export const DAILY_LIMIT_MESSAGE = `Daily ${realAccountShort()} limit reached — trading resumes tomorrow.`;
export const REAL_ENTRY_MAX_AGE_MS = 3_500;
export const EXIT_WINDOW_MS = 60_000;
export const REFUND_AFTER_MS = 10 * 60_000;

export interface PriceTick {
  epochMs: number;
  price: number;
}

export function normalizePipSize(pipSize: number): number {
  if (!Number.isFinite(pipSize) || pipSize <= 0) return 0.01;
  if (Number.isInteger(pipSize) && pipSize >= 1 && pipSize <= 8) {
    return 10 ** -pipSize;
  }
  return pipSize;
}

export function extractLastDigit(
  quote: number,
  pipSize: number,
): number | null {
  if (!Number.isFinite(quote) || !Number.isFinite(pipSize) || pipSize <= 0)
    return null;
  const pip = normalizePipSize(pipSize);
  if (pip <= 0) return null;
  const scaled = Math.round(Math.abs(quote) / pip);
  if (!Number.isFinite(scaled)) return null;
  return scaled % 10;
}

export function lastDigitOfPrice(price: number): number {
  const raw = Math.abs(price).toFixed(5).replace(".", "").replace(/0+$/, "");
  const digits = raw.length ? raw : "0";
  return Number(digits[digits.length - 1] ?? "0");
}

export function isValidDigit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 9
  );
}

export type DigitContractKind =
  | "EVEN"
  | "ODD"
  | "MATCH"
  | "DIFFER"
  | "OVER"
  | "UNDER";
export type ContractResult = "WIN" | "LOSS";
export const DIGIT_CONTRACT_KINDS: readonly DigitContractKind[] = [
  "EVEN",
  "ODD",
  "MATCH",
  "DIFFER",
  "OVER",
  "UNDER",
];

export function contractKindOf(option: DigitContractOption): DigitContractKind {
  return option.toUpperCase() as DigitContractKind;
}

export function contractNeedsTarget(kind: DigitContractKind): boolean {
  return kind !== "EVEN" && kind !== "ODD";
}

export function selectionForKind(
  kind: DigitContractKind,
  target: number | null,
): DigitContractSelection {
  const contractOption = kind.toLowerCase() as DigitContractOption;
  if (kind === "EVEN" || kind === "ODD")
    return {
      contractType: "EVEN_ODD",
      contractOption,
      selectedDigit: null,
      barrier: null,
    };
  if (kind === "MATCH" || kind === "DIFFER")
    return {
      contractType: "MATCH_DIFFER",
      contractOption,
      selectedDigit: target,
      barrier: null,
    };
  return {
    contractType: "OVER_UNDER",
    contractOption,
    selectedDigit: null,
    barrier: target,
  };
}

export function selectionTarget(
  selection: DigitContractSelection,
): number | null {
  if (selection.contractType === "MATCH_DIFFER") return selection.selectedDigit;
  if (selection.contractType === "OVER_UNDER") return selection.barrier;
  return null;
}

export function calculateTradeResult(
  contractType: DigitContractKind,
  selectedDigit: number | null,
  finalDigit: number,
): ContractResult {
  const option = contractType.toLowerCase();
  const matchTarget =
    contractType === "MATCH" || contractType === "DIFFER"
      ? selectedDigit
      : null;
  const barrier =
    contractType === "OVER" || contractType === "UNDER" ? selectedDigit : null;
  return calculateAccountTradeResult(finalDigit, option, matchTarget, barrier);
}

export function winProbability(
  selection: DigitContractSelection,
  winRatePercent: number = DEFAULT_WIN_RATE_PERCENT,
): number {
  return winningDigitCount(selection, winRatePercent) / 10;
}

export function settleDigitContract(input: {
  contractType: DigitContractType;
  contractOption: DigitContractOption;
  selectedDigit: number | null;
  barrier: number | null;
  exitPrice: number;
  exitDigit?: number | null;
  winRatePercent?: number;
}): DigitOutcome {
  return settleViaOutcome(input);
}

export function payoutFor(
  stake: number,
  payoutRate: number,
  outcome: DigitOutcome | "cancelled",
): number {
  if (outcome === "won")
    return Math.floor(stake * (1 + payoutRate) * 100 + 1e-6) / 100;
  if (outcome === "tie" || outcome === "cancelled") return stake;
  return 0;
}

export function potentialPayout(
  stake: number,
  selection: DigitContractSelection,
): number {
  if (!contractCanWin(selection)) return 0;
  return payoutFor(stake, digitPayoutRate(selection), "won");
}

export function selectExitTick<T extends PriceTick>(
  ticks: readonly T[],
  expiryMs: number,
): T | null {
  let best: T | null = null;
  for (const tick of ticks) {
    if (
      !Number.isFinite(tick.epochMs) ||
      !Number.isFinite(tick.price) ||
      tick.epochMs < expiryMs
    )
      continue;
    if (!best || tick.epochMs < best.epochMs) best = tick;
  }
  return best;
}

export function validateContractSelection(input: {
  contractType?: unknown;
  contractOption?: unknown;
  selectedDigit?: unknown;
  barrier?: unknown;
}): string | null {
  const type = input.contractType as DigitContractType;
  const options =
    typeof type === "string" ? DIGIT_CONTRACT_OPTIONS[type] : undefined;
  if (
    !options ||
    !options.includes(input.contractOption as DigitContractOption)
  ) {
    return "Select a contract type and option.";
  }
  if (type === "MATCH_DIFFER" && !isValidDigit(input.selectedDigit)) {
    return "Select a digit from 0 to 9 for MATCH / DIFFER.";
  }
  if (type === "OVER_UNDER" && !isValidDigit(input.barrier)) {
    return "Select a barrier digit from 0 to 9 for OVER / UNDER.";
  }
  const selection: DigitContractSelection = {
    contractType: type,
    contractOption: input.contractOption as DigitContractOption,
    selectedDigit:
      type === "MATCH_DIFFER" && isValidDigit(input.selectedDigit)
        ? input.selectedDigit
        : null,
    barrier:
      type === "OVER_UNDER" && isValidDigit(input.barrier)
        ? input.barrier
        : null,
  };
  if (!contractCanWin(selection)) return CANNOT_WIN_WARNING;
  return null;
}

export function validateRealStake(
  stake: unknown,
  availableBalance?: number | null,
  bounds?: { min?: number; max?: number },
): string | null {
  const min = bounds?.min ?? REAL_STAKE_MIN;
  const max = bounds?.max ?? REAL_STAKE_MAX;
  if (typeof stake !== "number" || !Number.isFinite(stake))
    return "Enter a stake amount.";
  if (Math.abs(Math.round(stake * 100) - stake * 100) > 1e-6)
    return "Stake can have at most 2 decimal places.";
  if (stake < min) return `Minimum stake is $${min}.`;
  if (stake > max) return `Maximum stake is $${max}.`;
  if (availableBalance != null && stake > availableBalance)
    return `Insufficient ${realAccountShort()} balance for this stake.`;
  return null;
}

export interface RealTradeRequest {
  accountMode: "REAL";
  symbol: (typeof REAL_TRADE_SYMBOLS)[number];
  contractType: DigitContractType;
  contractOption: DigitContractOption;
  selectedDigit: number | null;
  barrier: number | null;
  stake: number;
  durationTicks: number | null;
  durationMs: number | null;
  idempotencyKey: string;
}

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

export function validateRealTradeRequest(
  body: Record<string, unknown>,
  bounds?: { stakeMin?: number; stakeMax?: number },
): { ok: true; value: RealTradeRequest } | { ok: false; error: string } {
  if (body.account_mode !== "REAL") {
    return {
      ok: false,
      error: `This order is not marked for the ${realAccountName()}. Reload the page and try again.`,
    };
  }
  const symbol = String(body.symbol ?? "");
  if (!(REAL_TRADE_SYMBOLS as readonly string[]).includes(symbol)) {
    return {
      ok: false,
      error: `This market is not available for ${realAccountShort()} trading.`,
    };
  }
  const contractType = body.contract_type as DigitContractType;
  const selection = validateContractSelection({
    contractType,
    contractOption: body.contract_option,
    selectedDigit: body.selected_digit,
    barrier: body.barrier,
  });
  if (selection) return { ok: false, error: selection };
  const stakeError = validateRealStake(body.stake, null, {
    min: bounds?.stakeMin,
    max: bounds?.stakeMax,
  });
  if (stakeError) return { ok: false, error: stakeError };
  let durationTicks: number | null = null;
  let durationMs: number | null = null;
  if (body.duration_ticks !== undefined && body.duration_ticks !== null) {
    if (!isValidTickDuration(body.duration_ticks)) {
      return {
        ok: false,
        error: `Select a duration of ${TICK_DURATION_MIN}–${TICK_DURATION_MAX} ticks.`,
      };
    }
    durationTicks = body.duration_ticks;
  } else {
    if (!TRADE_DURATIONS.some((item) => item.ms === body.duration)) {
      return { ok: false, error: "Select a valid duration." };
    }
    durationMs = body.duration as number;
  }
  const idempotencyKey = String(body.idempotency_key ?? "");
  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey))
    return { ok: false, error: "Invalid request." };
  return {
    ok: true,
    value: {
      accountMode: "REAL",
      symbol: symbol as RealTradeRequest["symbol"],
      contractType,
      contractOption: body.contract_option as DigitContractOption,
      selectedDigit:
        contractType === "MATCH_DIFFER"
          ? (body.selected_digit as number)
          : null,
      barrier: contractType === "OVER_UNDER" ? (body.barrier as number) : null,
      stake: body.stake as number,
      durationTicks,
      durationMs,
      idempotencyKey,
    },
  };
}
