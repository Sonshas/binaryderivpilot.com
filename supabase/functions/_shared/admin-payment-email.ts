import { logEdgeError } from './server.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

function parseEmails(raw: string | undefined): string[] {
  if (!raw) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase()
    if (!email.includes('@') || seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}

function adminRecipients(): string[] {
  return parseEmails(Deno.env.get('ADMIN_EMAILS') ?? Deno.env.get('VITE_ADMIN_EMAILS') ?? '')
}

function formatKes(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0'
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
}

export type AdminPaymentKind = 'deposit' | 'verification' | 'scanner' | 'tax' | 'service_charge'

function kindLabel(kind: AdminPaymentKind): string {
  if (kind === 'deposit') return 'deposit'
  if (kind === 'verification') return 'account verification'
  if (kind === 'scanner') return 'AI scanner'
  if (kind === 'tax') return 'tax compliance'
  return 'payment'
}

/**
 * Email every allow-listed admin when a deposit or service payment clears.
 * Uses Resend when RESEND_API_KEY is set. Never throws — credit path must stay successful.
 */
export async function notifyAdminsPaymentReceived(
  admin: SupabaseClient,
  input: {
    amountKes: number
    kind?: AdminPaymentKind
    userEmail?: string | null
    receipt?: string | null
    depositId?: string | null
  },
): Promise<void> {
  const amountKes = Number(input.amountKes)
  if (!Number.isFinite(amountKes) || amountKes <= 0) return

  const recipients = adminRecipients()
  if (recipients.length === 0) {
    console.log('admin payment email skipped: no ADMIN_EMAILS')
    return
  }

  const apiKey = Deno.env.get('RESEND_API_KEY')?.trim()
  if (!apiKey) {
    // Expected until Resend is configured — do not open a staff system issue.
    console.log('admin payment email skipped: RESEND_API_KEY not set')
    return
  }

  const from =
    Deno.env.get('RESEND_FROM')?.trim() ||
    Deno.env.get('ADMIN_PAYMENT_EMAIL_FROM')?.trim() ||
    'Payments <onboarding@resend.dev>'
  const kes = formatKes(amountKes)
  const kind = input.kind ?? 'deposit'
  const label = kindLabel(kind)
  const subject = `You have received KES ${kes}`
  const lines = [
    `You have received KES ${kes}.`,
    '',
    `Type: ${label}`,
  ]
  if (input.userEmail) lines.push(`From member: ${input.userEmail}`)
  if (input.receipt) lines.push(`M-Pesa receipt: ${input.receipt}`)
  if (input.depositId) lines.push(`Reference: ${input.depositId}`)
  const text = lines.join('\n')

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        text,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      await logEdgeError(
        admin,
        'deposits',
        'admin_payment_email.send',
        `Resend HTTP ${res.status}: ${body.slice(0, 300)}`,
        { code: String(res.status) },
      )
      return
    }
    console.log('admin payment email sent', kes, kind, recipients.length)
  } catch (err) {
    await logEdgeError(admin, 'deposits', 'admin_payment_email.send', err)
  }
}

export async function lookupUserEmail(
  admin: SupabaseClient,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null
  const { data } = await admin.from('users').select('email').eq('id', userId).maybeSingle()
  const email = (data as { email?: string | null } | null)?.email
  return typeof email === 'string' && email.includes('@') ? email : null
}
