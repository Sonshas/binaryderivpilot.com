import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders, json } from '../_shared/server.ts'
import { withFreshDb } from '../_shared/direct-db.ts'

/**
 * Phone login cannot use PostgREST: /rest/v1/rpc/email_for_phone holds a
 * connection until it times out, which is what fills the pool and takes
 * login and admin down. Read the same row through the pooler instead.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let phone = ''
  try {
    const body = await req.json()
    phone = String(body?.phone ?? '').replace(/\D/g, '').slice(0, 20)
  } catch {
    return json({ email: null }, 400)
  }
  if (phone.length < 6) return json({ email: null }, 400)

  try {
    const rows = await withFreshDb(
      (sql) =>
        sql<{ email: string }[]>`
          select u.email
          from public.profiles p
          join public.users u on u.id = p.user_id
          where public.normalize_profile_phone(p.phone) = public.normalize_profile_phone(${phone})
            and public.normalize_profile_phone(${phone}) <> ''
          limit 1
        `,
      3500,
    )
    const email = rows[0]?.email?.trim().toLowerCase() ?? null
    return json({ email: email && email.includes('@') ? email : null })
  } catch {
    return json({ email: null, error: 'unavailable' }, 503)
  }
})
