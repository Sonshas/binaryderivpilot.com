import { nowIso } from '@/lib/ids'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { REAL_INTEGRATION } from '@/providers/config'
import type { KycStatus } from '@/types'

const KYC_KEY = 'sbb.kyc.reviews'
const REQUIRED_KEY = 'sbb.kyc.required'

export type KycDocumentType = 'national_id' | 'passport'

export interface KycRecord {
  email: string
  legalName: string
  dateOfBirth: string
  country: string
  documentType: KycDocumentType
  documentNumber: string
  idFront: string
  idBack: string
  idHolding: string
  status: 'pending' | 'approved' | 'rejected'
  submittedAt: string
  reviewedAt: string | null
  reviewNote: string
}

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

function readAll(): KycRecord[] {
  if (!canUseStorage()) return []
  try {
    const raw = localStorage.getItem(KYC_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as KycRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Never persist data-URL photos in localStorage — they blow the quota. */
function storageSafePhoto(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('data:')) return ''
  return trimmed.length > 500 ? trimmed.slice(0, 500) : trimmed
}

function storageSafeRecord(record: KycRecord): KycRecord {
  return {
    ...record,
    idFront: storageSafePhoto(record.idFront),
    idBack: storageSafePhoto(record.idBack),
    idHolding: storageSafePhoto(record.idHolding),
  }
}

function writeAll(rows: KycRecord[]): void {
  if (!canUseStorage()) return
  const safe = rows.map(storageSafeRecord)
  try {
    localStorage.setItem(KYC_KEY, JSON.stringify(safe))
  } catch {
    // Drop photo fields entirely and keep status metadata only.
    try {
      localStorage.setItem(
        KYC_KEY,
        JSON.stringify(
          safe.map((row) => ({
            ...row,
            idFront: '',
            idBack: '',
            idHolding: '',
          })),
        ),
      )
    } catch {
      /* ignore */
    }
  }
}

function readRequired(): Record<string, boolean> {
  if (!canUseStorage()) return {}
  try {
    const raw = localStorage.getItem(REQUIRED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, boolean>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function mapStatus(value: string | null | undefined): KycRecord['status'] {
  if (value === 'approved' || value === 'rejected' || value === 'pending') return value
  if (value === 'active') return 'pending'
  return 'pending'
}

function recordFromPaths(
  email: string,
  paths: unknown,
  status: string,
  submittedAt: string,
  reviewedAt: string | null,
  notes: string | null,
): KycRecord {
  const docs = Array.isArray(paths) ? paths.map((item) => String(item ?? '')) : []
  return {
    email: email.trim().toLowerCase(),
    legalName: '',
    dateOfBirth: '',
    country: '',
    documentType: 'national_id',
    documentNumber: '',
    idFront: docs[0] ?? '',
    idBack: docs[1] ?? '',
    idHolding: docs[2] ?? '',
    status: mapStatus(status),
    submittedAt,
    reviewedAt,
    reviewNote: notes ?? '',
  }
}

function cacheLocal(record: KycRecord): void {
  const rows = readAll().filter((row) => row.email !== record.email)
  rows.push(storageSafeRecord(record))
  writeAll(rows)
}

export function kycRequiredFor(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return false
  return readRequired()[normalized] === true
}

export function setKycRequired(email: string, required: boolean): void {
  const normalized = email.trim().toLowerCase()
  if (!normalized || !canUseStorage()) return
  const next = readRequired()
  next[normalized] = required
  localStorage.setItem(REQUIRED_KEY, JSON.stringify(next))
}

export function kycStatusFor(email: string | null | undefined): KycStatus {
  const row = loadKyc(email)
  return row?.status ?? 'not_started'
}

/** Sync local cache only — prefer fetchOwnKyc / fetchKycByEmail for live data. */
export function loadKyc(email: string | null | undefined): KycRecord | null {
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return null
  return readAll().find((row) => row.email === normalized) ?? null
}

export function listKyc(): KycRecord[] {
  return readAll().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
}

export function identityOnFile(record: KycRecord | null): boolean {
  if (!record || (record.status !== 'pending' && record.status !== 'approved')) return false
  return Boolean(record.idFront && record.idBack && record.idHolding)
}

export async function fetchOwnKyc(email: string | null | undefined): Promise<KycRecord | null> {
  const normalized = email?.trim().toLowerCase() ?? ''
  if (!REAL_INTEGRATION.backendConfigured || !isSupabaseConfigured) {
    return loadKyc(normalized)
  }
  const client = getSupabase()
  if (!client) return loadKyc(normalized)
  const {
    data: { session },
  } = await client.auth.getSession()
  if (!session?.user) return loadKyc(normalized)

  const { data, error } = await client
    .from('kyc_reviews')
    .select('id, user_id, status, document_paths, notes, created_at, reviewed_at')
    .eq('user_id', session.user.id)
    .neq('status', 'superseded')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return loadKyc(normalized)
  const record = recordFromPaths(
    normalized || session.user.email || '',
    data.document_paths,
    data.status,
    data.created_at,
    data.reviewed_at,
    data.notes,
  )
  cacheLocal(record)
  return record
}

export async function submitKyc(input: {
  email: string
  idFront: string
  idBack: string
  idHolding: string
}): Promise<KycRecord> {
  const email = input.email.trim().toLowerCase()
  const local: KycRecord = {
    email,
    legalName: '',
    dateOfBirth: '',
    country: '',
    documentType: 'national_id',
    documentNumber: '',
    idFront: input.idFront,
    idBack: input.idBack,
    idHolding: input.idHolding,
    status: 'pending',
    submittedAt: nowIso(),
    reviewedAt: null,
    reviewNote: '',
  }

  if (REAL_INTEGRATION.backendConfigured && isSupabaseConfigured) {
    const client = getSupabase()
    if (client) {
      const {
        data: { session },
      } = await client.auth.getSession()
      if (session?.user) {
        const { data, error } = await client.rpc('submit_own_kyc', {
          p_front: input.idFront,
          p_back: input.idBack,
          p_holding: input.idHolding,
        })
        if (error || !data) {
          throw new Error('Those photos could not be saved. Use smaller images and try again.')
        }
        const row = data as {
          status?: string
          document_paths?: unknown
          created_at?: string
          reviewed_at?: string | null
          notes?: string | null
        }
        const record = recordFromPaths(
          email,
          row.document_paths ?? [input.idFront, input.idBack, input.idHolding],
          row.status ?? 'pending',
          row.created_at ?? local.submittedAt,
          row.reviewed_at ?? null,
          row.notes ?? null,
        )
        cacheLocal(record)
        return record
      }
    }
  }

  // Offline/local mode still needs the photos in memory for admin review UI,
  // but only persist storage-safe fields (no data URLs).
  const rows = readAll().filter((row) => row.email !== email)
  rows.push(storageSafeRecord(local))
  writeAll(rows)
  return local
}

export function reviewKyc(email: string, status: 'approved' | 'rejected', note: string): KycRecord | null {
  const normalized = email.trim().toLowerCase()
  const current = loadKyc(normalized)
  if (!current) return null
  const next: KycRecord = {
    ...current,
    status,
    reviewedAt: nowIso(),
    reviewNote: note.trim(),
  }
  writeAll(readAll().map((row) => (row.email === normalized ? next : row)))
  return next
}

export function recordFromAdminRow(row: {
  user_email?: unknown
  status?: unknown
  document_paths?: unknown
  created_at?: unknown
  reviewed_at?: unknown
  notes?: unknown
}): KycRecord | null {
  const email = typeof row.user_email === 'string' ? row.user_email.trim().toLowerCase() : ''
  if (!email) return null
  return recordFromPaths(
    email,
    row.document_paths,
    String(row.status ?? 'pending'),
    typeof row.created_at === 'string' ? row.created_at : nowIso(),
    typeof row.reviewed_at === 'string' ? row.reviewed_at : null,
    typeof row.notes === 'string' ? row.notes : null,
  )
}

export function rekeyKycEmail(fromEmail: string, toEmail: string): void {
  const from = fromEmail.trim().toLowerCase()
  const to = toEmail.trim().toLowerCase()
  if (!from || !to || from === to || !canUseStorage()) return
  writeAll(readAll().map((row) => (row.email === from ? { ...row, email: to } : row)))
  const required = readRequired()
  if (from in required) {
    required[to] = required[from]
    delete required[from]
    localStorage.setItem(REQUIRED_KEY, JSON.stringify(required))
  }
}
