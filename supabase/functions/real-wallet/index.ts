import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withFreshDb } from "../_shared/direct-db.ts";
import {
  adminClient,
  corsHeaders,
  json,
  userFromRequest,
} from "../_shared/server.ts";

type WalletRow = Record<string, unknown>;

const WALLET_COLUMNS =
  "id, user_id, account_id, account_mode, currency, balance, available_balance, locked_balance, status, is_simulated, created_at, updated_at";

/**
 * REAL wallet read that bypasses the hung external PostgREST Data API.
 * Prefer direct Postgres; fall back to in-edge PostgREST (works inside Supabase).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const admin = adminClient();
  const user = await userFromRequest(admin, req);
  if (!user) return json({ error: "Sign in to continue." }, 401);

  try {
    const wallet = await withFreshDb(async (sql) => {
      const rows = await sql`
        select id, user_id, account_id, account_mode, currency, balance,
               available_balance, locked_balance, status, is_simulated,
               created_at, updated_at
          from public.wallets
         where user_id = ${user.id}
           and account_mode = 'real'
         limit 1
      `;
      return (rows[0] as WalletRow | undefined) ?? null;
    }, 5_000);
    return json({ wallet });
  } catch (directErr) {
    console.error(
      "real-wallet.direct",
      directErr instanceof Error ? directErr.message : "error",
    );
  }

  try {
    const result = await Promise.race([
      admin
        .from("wallets")
        .select(WALLET_COLUMNS)
        .eq("user_id", user.id)
        .eq("account_mode", "real")
        .maybeSingle(),
      new Promise<{ data: null; error: { message: string } }>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), 4_000);
      }),
    ]);
    if (result.error) {
      console.error("real-wallet.rest", result.error.message);
      return json({ error: "Real balance is unavailable right now." }, 503);
    }
    return json({ wallet: result.data ?? null });
  } catch {
    console.error("real-wallet", "read timed out");
    return json({ error: "Real balance is unavailable right now." }, 503);
  }
});
