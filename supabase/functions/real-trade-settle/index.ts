import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { REAL_TRADE_SYMBOLS } from '../_shared/digit-contracts.ts'
import {
  DerivSession,
  TRADE_COLUMNS,
  adminClient,
  corsHeaders,
  fetchFreshTick,
  json,
  settleTrades,
  userFromRequest,
  type OpenTradeRow,
} from '../_shared/trading-server.ts'
import { runDirect } from '../_shared/direct-db.ts'
import { logEdgeError } from '../_shared/server.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SWEEP_BATCH = 100
const USER_BATCH = 10

async function loadDueTrades(input: {
  limit: number
  userId?: string
  tradeId?: string | null
}): Promise<OpenTradeRow[]> {
  const limit = input.limit
  const userId = input.userId ?? null
  const tradeId = input.tradeId ?? null
  try {
    const rows = await runDirect(
      (sql) => sql<OpenTradeRow[]>`
        select id, user_id, symbol, contract_type, contract_option, selected_digit,
               barrier, stake, expires_at, duration_ticks, tick_anchor_epoch
          from public.trades
         where account_mode = 'real'
           and is_simulated = false
           and status = 'open'
           and (
             expires_at <= now()
             or (
               duration_ticks is not null
               and tick_anchor_epoch is not null
               and tick_anchor_epoch <= extract(epoch from now())::bigint
             )
           )
           and (${userId}::uuid is null or user_id = ${userId}::uuid)
           and (${tradeId}::uuid is null or id = ${tradeId}::uuid)
         order by expires_at asc
         limit ${limit}
      `,
      2_000,
    )
    return rows
  } catch (err) {
    console.error(
      'settle.load.direct',
      err instanceof Error ? err.message : 'error',
    )
    // Skip hung PostgREST — return empty so settle can no-op instead of 500.
    return []
  }
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  } catch {
    return {}
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const admin = adminClient()
  const body = await readBody(req)
  const sweepSecret = req.headers.get('x-sweep-secret')

  if (sweepSecret) {
    const { data: valid } = await Promise.race([
      admin.rpc('verify_real_trade_sweep_secret', { p_secret: sweepSecret }),
      new Promise<{ data: null }>((resolve) =>
        setTimeout(() => resolve({ data: null }), 3_000),
      ),
    ])
    if (valid !== true) return json({ error: 'Unauthorized' }, 401)

    if (body.mode === 'diagnose') {
      const symbol = (REAL_TRADE_SYMBOLS as readonly string[]).includes(String(body.symbol))
        ? String(body.symbol)
        : 'R_100'
      const started = Date.now()
      let session: DerivSession | null = null
      try {
        session = await Promise.race([
          DerivSession.open(),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('Deriv connect timeout')), 8_000),
          ),
        ])
        const tick = session ? await fetchFreshTick(session, symbol) : null
        return json({ mode: 'diagnose', symbol, tick, elapsed_ms: Date.now() - started })
      } catch (err) {
        return json(
          {
            mode: 'diagnose',
            symbol,
            tick: null,
            error: String(err),
            elapsed_ms: Date.now() - started,
          },
          502,
        )
      } finally {
        session?.close()
      }
    }

    try {
      const data = await loadDueTrades({ limit: SWEEP_BATCH })
      const results = await settleTrades(admin, data)
      if (results.length) console.log('sweep', JSON.stringify(results))
      return json({ mode: 'sweep', processed: results.length, results })
    } catch (error) {
      await logEdgeError(admin, 'trading', 'real-trade-settle.sweep_load', error)
      return json({ error: 'load failed' }, 500)
    }
  }

  const user = await userFromRequest(admin, req)
  if (!user) return json({ error: 'Sign in to view trades.' }, 401)

  const tradeId = body.trade_id == null ? null : String(body.trade_id)
  if (tradeId != null && !UUID_RE.test(tradeId)) return json({ error: 'Invalid trade id.' }, 400)

  let data: OpenTradeRow[] = []
  try {
    data = await loadDueTrades({
      limit: USER_BATCH,
      userId: user.id,
      tradeId,
    })
  } catch (error) {
    await logEdgeError(admin, 'trading', 'real-trade-settle.user_load', error, {
      userId: user.id,
    })
    return json({ error: 'Could not load trades.' }, 500)
  }

  const results = await settleTrades(admin, data)

  let trades: unknown[] = []
  if (tradeId) {
    try {
      const rows = await runDirect(
        (sql) =>
          sql<Record<string, unknown>[]>`
            select *
              from public.trades
             where id = ${tradeId}::uuid
               and user_id = ${user.id}::uuid
               and account_mode = 'real'
             limit 1
          `,
        3_000,
      )
      if (!rows[0]) return json({ error: 'Trade not found.' }, 404)
      trades = rows
    } catch {
      const { data: row } = await Promise.race([
        admin
          .from('trades')
          .select(TRADE_COLUMNS)
          .eq('id', tradeId)
          .eq('user_id', user.id)
          .eq('account_mode', 'real')
          .maybeSingle(),
        new Promise<{ data: null }>((resolve) =>
          setTimeout(() => resolve({ data: null }), 3_000),
        ),
      ])
      if (!row) return json({ error: 'Trade not found.' }, 404)
      trades = [row]
    }
  }
  return json({
    processed: results.length,
    results: results.map(({ tradeId: id, result }) => ({ trade_id: id, result })),
    trades,
  })
})
