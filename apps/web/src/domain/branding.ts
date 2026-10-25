function read(key: string, fallback: string): string {
  let vite = "";
  try {
    vite = String(
      (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
        .env?.[key] ?? "",
    ).trim();
  } catch {
    vite = "";
  }
  let deno = "";
  try {
    const runtime = globalThis as {
      Deno?: { env?: { get?: (k: string) => string | undefined } };
    };
    deno = String(runtime.Deno?.env?.get?.(key) ?? "").trim();
  } catch {
    deno = "";
  }
  return vite || deno || fallback;
}

export function demoAccountName(): string {
  return read(
    "DEMO_ACCOUNT_NAME",
    read("VITE_DEMO_ACCOUNT_NAME", "Demo account"),
  );
}

export function realAccountName(): string {
  return read(
    "REAL_ACCOUNT_NAME",
    read("VITE_REAL_ACCOUNT_NAME", "Real account"),
  );
}

export function demoAccountShort(): string {
  return read("DEMO_ACCOUNT_SHORT", read("VITE_DEMO_ACCOUNT_SHORT", "Demo"));
}

export function realAccountShort(): string {
  return read("REAL_ACCOUNT_SHORT", read("VITE_REAL_ACCOUNT_SHORT", "Real"));
}

export function siteUrl(fallback = "https://binaryderivpilot.com"): string {
  const raw = read("SITE_URL", read("VITE_SITE_URL", fallback));
  return raw.replace(/\/+$/, "");
}

export function siteApiUrl(path: string, fallback?: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${siteUrl(fallback)}${suffix}`;
}
