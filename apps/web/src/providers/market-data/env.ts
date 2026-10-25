import { realAccountShort } from "@/lib/branding";

export type MarketDataProviderId = "deriv" | "binance" | "none";

function readEnv(key: string): string {
  const value = (import.meta.env as Record<string, string | undefined>)[key];
  return typeof value === "string" ? value.trim() : "";
}

export function getMarketDataProviderId(): MarketDataProviderId {
  const raw = readEnv("VITE_MARKET_DATA_PROVIDER").toLowerCase();
  if (raw === "deriv") return "deriv";
  if (raw === "binance") return "binance";
  return "none";
}

export function isMarketDataProviderConfigured(): boolean {
  const id = getMarketDataProviderId();
  return id === "deriv" || id === "binance";
}

export function getDerivAppId(): string {
  return readEnv("VITE_DERIV_APP_ID");
}

export function getDerivWsUrl(): string {
  const configured = readEnv("VITE_MARKET_DATA_WS_URL");
  if (configured && !configured.includes("ws.derivws.com/websockets/v3"))
    return configured;
  return "wss://api.derivws.com/trading/v1/options/ws/public";
}

export function getMarketDataApiUrl(): string {
  const configured = readEnv("VITE_MARKET_DATA_API_URL");
  if (configured) return configured;
  // Local Express helper only — production uses Deriv WS (or empty).
  return import.meta.env.DEV ? "http://localhost:3001" : "";
}

export function getMarketDataWsUrl(): string {
  return readEnv("VITE_MARKET_DATA_WS_URL") || "wss://stream.binance.com:9443";
}

export const REAL_FEED_LABEL_DERIV = "Live market prices";
export const REAL_FEED_LABEL_BINANCE = "Live market prices";
export const REAL_FEED_LABEL =
  getMarketDataProviderId() === "binance"
    ? REAL_FEED_LABEL_BINANCE
    : REAL_FEED_LABEL_DERIV;

export const REAL_MARKET_UNAVAILABLE =
  "Live market data is temporarily unavailable. Please try again shortly.";

export const REAL_EXECUTION_NOT_CONNECTED = `${realAccountShort()} trading is temporarily unavailable. Please try again shortly.`;
