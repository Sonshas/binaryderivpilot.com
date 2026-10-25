import {
  REAL_STAKE_MAX,
  REAL_STAKE_MIN,
  validateRealStake,
} from "@/domain/digit-contracts";
import type { BotProgress } from "@/domain/bot-strategies";
import { realAccountShort } from "@/lib/branding";
import type { TradeStatus } from "@/types";

export type RealStakeBounds = { min: number; max: number };

export const DEFAULT_REAL_STAKE_BOUNDS: RealStakeBounds = {
  min: REAL_STAKE_MIN,
  max: REAL_STAKE_MAX,
};

export type AutoAccount = "DEMO" | "REAL";

export const AUTO_TRADE_DEFAULTS = {
  targetProfit: 20,
  stopLoss: 50,
  multiplier: 2,
  maxLossStreak: 6,
  maxStake: 500,
} as const;
export const AUTO_MAX_TRADES_LIMIT = 1000;
export const AUTO_HIDDEN_DEFAULTS = {
  maxTrades: AUTO_MAX_TRADES_LIMIT,
  stopOnInsufficientBalance: true,
} as const;
export const AUTO_MULTIPLIER_MIN = 1;
export const AUTO_MULTIPLIER_MAX = 3;
export const AUTO_MIN_STAKE = 0.5;

export interface AutoTradeSettings {
  account: AutoAccount;
  durationTicks: number;
  baseStake: number;
  maxTrades: number;
  targetProfit: number;
  stopLoss: number;
  stopOnInsufficientBalance: boolean;
  multiplier: number;
  maxLossStreak: number;
  maxStake: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function nextAutoStake(
  lastStake: number,
  lastOutcome: Exclude<TradeStatus, "open"> | null,
  settings: Pick<AutoTradeSettings, "baseStake" | "multiplier">,
): number {
  if (lastOutcome == null || lastOutcome === "won")
    return round2(settings.baseStake);
  if (lastOutcome === "lost") return round2(lastStake * settings.multiplier);
  return round2(lastStake);
}

export function resolveAutoStake(
  nextStake: number,
  balance: number,
  settings: Pick<AutoTradeSettings, "baseStake" | "stopOnInsufficientBalance">,
): number {
  if (
    !settings.stopOnInsufficientBalance &&
    nextStake > balance &&
    settings.baseStake <= balance
  ) {
    return round2(settings.baseStake);
  }
  return nextStake;
}

export function validateAutoSettings(
  settings: AutoTradeSettings,
  realBounds: RealStakeBounds = DEFAULT_REAL_STAKE_BOUNDS,
): string | null {
  if (settings.account === "REAL") {
    const stakeError = validateRealStake(settings.baseStake, null, realBounds);
    if (stakeError) return stakeError;
    if (settings.maxStake > realBounds.max)
      return `Max stake for ${realAccountShort()} is $${realBounds.max}.`;
  } else if (
    !Number.isFinite(settings.baseStake) ||
    settings.baseStake < AUTO_MIN_STAKE
  ) {
    return `Base stake must be at least $${AUTO_MIN_STAKE.toFixed(2)}.`;
  }
  if (
    !Number.isInteger(settings.maxTrades) ||
    settings.maxTrades < 1 ||
    settings.maxTrades > AUTO_MAX_TRADES_LIMIT
  ) {
    return `Number of trades must be between 1 and ${AUTO_MAX_TRADES_LIMIT}.`;
  }
  if (!(settings.targetProfit > 0))
    return "Target profit must be greater than zero.";
  if (!(settings.stopLoss > 0)) return "Stop loss must be greater than zero.";
  if (
    !Number.isFinite(settings.multiplier) ||
    settings.multiplier < AUTO_MULTIPLIER_MIN ||
    settings.multiplier > AUTO_MULTIPLIER_MAX
  ) {
    return `Multiplier must be between ×${AUTO_MULTIPLIER_MIN} and ×${AUTO_MULTIPLIER_MAX}.`;
  }
  if (!Number.isInteger(settings.maxLossStreak) || settings.maxLossStreak < 1) {
    return "Max consecutive losses must be at least 1.";
  }
  if (!(settings.maxStake >= settings.baseStake))
    return "Max stake must be at least the base stake.";
  return null;
}

export function evaluateAutoStop(
  progress: Pick<BotProgress, "realizedPnl" | "lossStreak"> & {
    tradesPlaced?: number;
  },
  nextStake: number,
  availableBalance: number,
  settings: Pick<
    AutoTradeSettings,
    "targetProfit" | "stopLoss" | "maxLossStreak" | "maxStake"
  > &
    Partial<Pick<AutoTradeSettings, "account" | "maxTrades">>,
  realBounds: RealStakeBounds = DEFAULT_REAL_STAKE_BOUNDS,
): string | null {
  const account = settings.account ?? "DEMO";
  if (progress.realizedPnl >= settings.targetProfit) {
    return `Target profit reached (+$${progress.realizedPnl.toFixed(2)})`;
  }
  if (progress.realizedPnl <= -settings.stopLoss) {
    return `Stop loss reached (−$${Math.abs(progress.realizedPnl).toFixed(2)})`;
  }
  if (progress.lossStreak >= settings.maxLossStreak) {
    return `${progress.lossStreak} losses in a row — safety stop`;
  }
  if (
    settings.maxTrades != null &&
    (progress.tradesPlaced ?? 0) >= settings.maxTrades
  ) {
    return `Completed ${progress.tradesPlaced} of ${settings.maxTrades} trades`;
  }
  if (nextStake > settings.maxStake) {
    return `Next stake $${nextStake.toFixed(2)} is above the max stake $${settings.maxStake.toFixed(2)}`;
  }
  if (account === "REAL" && nextStake > realBounds.max) {
    return `Next stake $${nextStake.toFixed(2)} is above the ${realAccountShort()} limit of $${realBounds.max}`;
  }
  if (nextStake > availableBalance) {
    return `Balance too low for the next $${nextStake.toFixed(2)} stake`;
  }
  return null;
}
