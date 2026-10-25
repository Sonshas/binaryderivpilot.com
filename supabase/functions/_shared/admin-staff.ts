import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2'
import { isDashboardAdminRole } from './admin-dashboard.ts'
import { logEdgeError } from './server.ts'

function parseAdminEmails(raw: string | undefined): Set<string> {
  const emails = new Set<string>()
  if (!raw) return emails
  for (const part of raw.split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase()
    if (email.includes('@')) emails.add(email)
  }
  return emails
}

/** Admin allow-list from Edge secrets / env only — not stored in the database. */
const ADMIN_EMAILS = parseAdminEmails(
  Deno.env.get('ADMIN_EMAILS') ?? Deno.env.get('VITE_ADMIN_EMAILS') ?? '',
)

export function appRole(user: User): string {
  const meta = (user.app_metadata ?? {}) as Record<string, unknown>
  return typeof meta.role === 'string' ? meta.role.trim() : ''
}

/**
 * Admin console access from allow-listed emails in env.
 * When ADMIN_EMAILS is set, that list is authoritative (no DB role required).
 */
export function isAdmin(user: User): boolean {
  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : ''
  if (ADMIN_EMAILS.size > 0) {
    return !!email && ADMIN_EMAILS.has(email)
  }
  return isDashboardAdminRole(appRole(user))
}

/** @deprecated use isAdmin */
export function isStaff(user: User): boolean {
  return isAdmin(user)
}

export async function writeAudit(
  admin: SupabaseClient,
  input: {
    actorId: string
    actorEmail: string | null
    action: string
    userId?: string | null
    targetType?: string | null
    targetId?: string | null
    before?: Record<string, unknown>
    after?: Record<string, unknown>
  },
) {
  const { error } = await admin.from('audit_log').insert({
    actor_id: input.actorId,
    actor_email: input.actorEmail,
    action: input.action,
    user_id: input.userId ?? null,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    before_state: input.before ?? {},
    after_state: input.after ?? {},
  })
  if (error) await logEdgeError(admin, 'admin', 'audit_log.insert', error, { code: error.code })
}
