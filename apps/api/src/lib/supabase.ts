import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types.js'

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in the repo-root .env file.`,
    )
  }
  return value
}

const supabaseUrl = requireEnv('SUPABASE_URL', process.env.SUPABASE_URL)
const serviceRoleKey = requireEnv(
  'SUPABASE_SERVICE_ROLE_KEY',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

export const supabaseAdmin = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})
