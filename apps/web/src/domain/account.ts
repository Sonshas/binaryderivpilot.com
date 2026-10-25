import { accountDisplayName, realAccountName } from "@/lib/branding";
import type {
  AccountMode,
  RealAccountStatus,
  RealAccountView,
  RealCapabilityMap,
} from "@/types";

export const DEMO_USER_ID = "user_demo_local";
export const REAL_USER_ID = "user_real_unlinked";
export const DEMO_ACCOUNT_ID = "acct_demo_local";
export const REAL_ACCOUNT_ID = "acct_real_unlinked";
export const DEMO_WALLET_ID = "wallet_demo_local";
export const REAL_WALLET_ID = "wallet_real_unlinked";

export function realStatusLabel(status: RealAccountStatus): string {
  const name = realAccountName();
  if (status === "NOT_CONNECTED") return `${name} unavailable`;
  if (status === "READY") return `${name} ready`;
  if (status === "ACTIVE") return `${name} active`;
  return `${name} restricted`;
}

export function realUnavailableTrading(): string {
  return `${realAccountName()} trading is temporarily unavailable.`;
}

export function realUnavailablePayments(): string {
  return `${realAccountName()} payments are currently unavailable.`;
}

export function realUnavailableWithdrawals(): string {
  return `${realAccountName()} withdrawals are currently unavailable.`;
}

export function realUnavailableBots(): string {
  return `${realAccountName()} auto-trade is currently unavailable.`;
}

export const REAL_UNAVAILABLE_TRADING = realUnavailableTrading();
export const REAL_UNAVAILABLE_PAYMENTS = realUnavailablePayments();
export const REAL_UNAVAILABLE_WITHDRAWALS = realUnavailableWithdrawals();
export const REAL_UNAVAILABLE_BOTS = realUnavailableBots();
export const LIVE_MARKET_UNAVAILABLE = "Live market data unavailable.";
export const REAL_BALANCE_PLACEHOLDER = "—";
export const REAL_BALANCE_LOADING = "Loading…";

export type AuthConnectionStatus = "Signed in" | "Signed out";

export function authConnectionStatus(
  isSignedIn: boolean,
): AuthConnectionStatus {
  return isSignedIn ? "Signed in" : "Signed out";
}

export function realNeedsExplanation(): string {
  const real = realAccountName();
  return `${real} is temporarily unavailable. Please try again shortly.`;
}

export function accountModeLabel(mode: AccountMode): string {
  return accountDisplayName(mode);
}

export function deriveRealStatus(
  capabilities: RealCapabilityMap,
): RealAccountStatus {
  if (!capabilities.backendConfigured) return "NOT_CONNECTED";
  if (!capabilities.complianceConfigured) return "RESTRICTED";
  if (
    capabilities.marketDataConfigured &&
    capabilities.executionConfigured &&
    capabilities.paymentConfigured
  ) {
    return "READY";
  }
  return "RESTRICTED";
}

export function buildRealAccountView(
  capabilities: RealCapabilityMap,
): RealAccountView {
  const status = deriveRealStatus(capabilities);
  const on = (ok: boolean) => (ok ? "Available" : "Unavailable");
  const real = realAccountName();
  return {
    status,
    label: realStatusLabel(status),
    balanceDisplay: "—",
    marketData: on(capabilities.marketDataConfigured),
    tradingExecution: on(capabilities.executionConfigured),
    deposits: on(capabilities.depositsConfigured),
    withdrawals: on(capabilities.withdrawalsConfigured),
    explanation: capabilities.marketDataConfigured
      ? `${real} is available when live prices and trading are ready.`
      : realNeedsExplanation(),
  };
}
