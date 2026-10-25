import {
  DIGIT_CONTRACT_OPTIONS,
  REAL_TRADE_SYMBOLS,
  contractCanWin,
  contractKindOf,
  contractNeedsTarget,
  isValidDigit,
  type DigitContractKind,
  type DigitContractSelection,
} from "@/domain/digit-contracts";
import { scanQuality, type ScannerPick } from "@/domain/digit-scanner";
import { shortMarketName } from "@/domain/market-sections";
import { realAccountShort } from "@/lib/branding";
import type { ContractOption, ContractType } from "@/types";

export const LOAD_PREDICTION_FIRST =
  "Load a prediction before starting Auto Trade.";
export const PREDICTION_CLEARED = "Prediction cleared — ticket changed";
export const PREDICTION_READY = "READY TO TRADE";

export interface ScanResult {
  id: string;
  contract: ContractType;
  side: ContractOption;
  digit?: number;
  barrier?: number;
  symbol: string;
  volatilityLabel: string;
  scannedAt: number;
  sampleSize: number;
  quality?: number;
  countsLine?: string;
  marketName?: string;
}

export type LoadedPrediction = ScanResult & { loadedAt: number };

export function volatilityLabelOf(
  symbol: string,
  displayName?: string | null,
): string {
  if (displayName) {
    const short = shortMarketName(displayName)
      .replace(/^Volatility\s+/i, "")
      .trim();
    if (short) return short;
  }
  const standard = /^R_(\d+)$/.exec(symbol);
  if (standard) return standard[1]!;
  const oneSecond = /^1HZ(\d+)V$/.exec(symbol);
  if (oneSecond) return `${oneSecond[1]} (1s)`;
  return symbol;
}

export function predictionLabel(
  prediction: Pick<ScanResult, "side" | "digit" | "barrier">,
): string {
  const side = prediction.side.toUpperCase();
  if (prediction.digit != null) return `${side} ${prediction.digit}`;
  if (prediction.barrier != null) return `${side} ${prediction.barrier}`;
  return side;
}

export function predictionText(
  kind: DigitContractKind,
  target: number | null,
): string {
  return contractNeedsTarget(kind) && target != null
    ? `${kind} ${target}`
    : kind;
}

export function loadedPredictionText(
  prediction: Pick<
    ScanResult,
    "side" | "digit" | "barrier" | "volatilityLabel"
  >,
): string {
  return `PREDICTION LOADED · ${predictionLabel(prediction)} · Volatility ${prediction.volatilityLabel} · ${PREDICTION_READY}`;
}

export function scanResultFromPick(
  pick: ScannerPick,
  volatilityLabel: string,
  scannedAt: number,
  id: string,
  marketName = volatilityLabel,
): ScanResult {
  return {
    id,
    contract: pick.contractType,
    side: pick.contractOption,
    ...(pick.contractType === "MATCH_DIFFER" && pick.selectedDigit != null
      ? { digit: pick.selectedDigit }
      : {}),
    ...(pick.contractType === "OVER_UNDER" && pick.barrier != null
      ? { barrier: pick.barrier }
      : {}),
    symbol: pick.symbol,
    volatilityLabel,
    scannedAt,
    sampleSize: pick.sampleSize,
    quality: scanQuality(pick.deviation),
    countsLine: pick.countsLine,
    marketName,
  };
}

export function selectionOf(
  prediction: Pick<ScanResult, "contract" | "side" | "digit" | "barrier">,
): DigitContractSelection {
  return {
    contractType: prediction.contract,
    contractOption: prediction.side,
    selectedDigit:
      prediction.contract === "MATCH_DIFFER"
        ? (prediction.digit ?? null)
        : null,
    barrier:
      prediction.contract === "OVER_UNDER"
        ? (prediction.barrier ?? null)
        : null,
  };
}

export interface PredictionOrder {
  symbol: string;
  contract: DigitContractKind;
  target: number | null;
  prediction: string;
  selection: DigitContractSelection;
}

export function orderFromPrediction(prediction: ScanResult): PredictionOrder {
  const selection = selectionOf(prediction);
  const contract = contractKindOf(selection.contractOption);
  const target = selection.selectedDigit ?? selection.barrier;
  return {
    symbol: prediction.symbol,
    contract,
    target,
    prediction: predictionText(contract, target),
    selection,
  };
}

export function validatePrediction(
  prediction: ScanResult | null,
  account: "DEMO" | "REAL",
): string | null {
  if (!prediction) return LOAD_PREDICTION_FIRST;
  if (!prediction.symbol) return "Choose a volatility index.";
  if (!DIGIT_CONTRACT_OPTIONS[prediction.contract]?.includes(prediction.side))
    return "The loaded prediction is invalid.";
  const selection = selectionOf(prediction);
  if (
    prediction.contract === "MATCH_DIFFER" &&
    !isValidDigit(selection.selectedDigit)
  )
    return "Choose a target digit from 0 to 9.";
  if (prediction.contract === "OVER_UNDER" && !isValidDigit(selection.barrier))
    return "Choose a target digit from 0 to 9.";
  if (!contractCanWin(selection))
    return "This contract cannot win — load another prediction.";
  if (
    account === "REAL" &&
    !(REAL_TRADE_SYMBOLS as readonly string[]).includes(prediction.symbol)
  ) {
    return `This market is not available for ${realAccountShort()} trading.`;
  }
  return null;
}

export interface TicketState {
  symbol: string;
  contractType: ContractType;
  side: ContractOption;
  selectedDigit: number;
  barrier: number;
}

export function ticketMatchesPrediction(
  prediction: ScanResult,
  ticket: TicketState,
): boolean {
  return (
    ticket.symbol === prediction.symbol &&
    ticket.contractType === prediction.contract &&
    ticket.side === prediction.side &&
    (prediction.contract !== "MATCH_DIFFER" ||
      ticket.selectedDigit === prediction.digit) &&
    (prediction.contract !== "OVER_UNDER" ||
      ticket.barrier === prediction.barrier)
  );
}
