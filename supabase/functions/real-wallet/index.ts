import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { readActivity, readActivityViaRest } from "../_shared/direct-money.ts";
import {
  adminClient,
  corsHeaders,
  json,
  userFromRequest,
} from "../_shared/server.ts";

/**
 * REAL wallet, deposits, withdrawals, and transactions.
 * Data API first. A pooler timeout must not drop the deposit list.
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
    const activity = await readActivityViaRest(user.id);
    return json({
      wallet: activity.wallet,
      deposits: activity.deposits,
      withdrawals: activity.withdrawals,
      transactions: activity.transactions,
    });
  } catch (restErr) {
    console.error(
      "real-wallet.rest",
      restErr instanceof Error ? restErr.message : "error",
    );
  }

  try {
    const activity = await readActivity(user.id);
    return json({
      wallet: activity.wallet,
      deposits: activity.deposits,
      withdrawals: activity.withdrawals,
      transactions: activity.transactions,
    });
  } catch (directErr) {
    console.error(
      "real-wallet.direct",
      directErr instanceof Error ? directErr.message : "error",
    );
    return json({ error: "Real balance is unavailable right now." }, 503);
  }
});
