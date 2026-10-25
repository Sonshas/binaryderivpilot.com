import type { AccountMode } from "@/types";
import {
  demoAccountName,
  demoAccountShort,
  realAccountName,
  realAccountShort,
  siteUrl,
} from "@/domain/branding";

export {
  demoAccountName,
  demoAccountShort,
  realAccountName,
  realAccountShort,
  siteUrl,
};

export function accountDisplayName(mode: AccountMode): string {
  return mode === "demo" ? demoAccountName() : realAccountName();
}

export function accountShortName(mode: AccountMode): string {
  return mode === "demo" ? demoAccountShort() : realAccountShort();
}

export function demoAccountUpper(): string {
  return demoAccountName().toUpperCase();
}

export function realAccountUpper(): string {
  return realAccountName().toUpperCase();
}

export function accountUpper(mode: AccountMode): string {
  return accountDisplayName(mode).toUpperCase();
}

export function siteHost(): string {
  try {
    return new URL(siteUrl()).host;
  } catch {
    return siteUrl()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
  }
}
