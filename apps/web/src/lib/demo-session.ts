import { DEMO_USER_ID } from '@/domain/account'
import { normalizeEmail, normalizePhone } from '@/lib/identity'
import { accountEnabled } from '@/lib/account-access'
import { roleWithAdminList } from '@/lib/admin-emails'
import { kycStatusFor } from '@/lib/kyc'
import { nowIso } from '@/lib/ids'
import { DEMO_SESSION_KEY } from '@/providers/config'
import type { User } from '@/types'

export interface DemoSession {
  userId: string
  email: string
  name: string
  phone: string
  country: string
  password: string
  createdAt: string
}

const CREDENTIALS_KEY = 'sbb.demo.credentials'
const listeners = new Set<() => void>()
let memory: DemoSession | null | undefined
let credentialMemory: DemoSession[] | null = null

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

function toUser(session: DemoSession): User {
  return {
    id: session.userId,
    email: session.email,
    name: session.name,
    role: roleWithAdminList(session.email, 'trader'),
    accountStatus: 'active',
    kycStatus: kycStatusFor(session.email),
    createdAt: session.createdAt,
    updatedAt: session.createdAt,
  }
}

function readCredentials(): DemoSession[] {
  if (credentialMemory) return credentialMemory
  if (!canUseStorage()) return []
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY)
    if (!raw) return []
    credentialMemory = JSON.parse(raw) as DemoSession[]
    return credentialMemory
  } catch {
    return []
  }
}

function writeCredentials(list: DemoSession[]): void {
  const clean = list.map((session) => ({
    userId: session.userId,
    email: session.email,
    name: session.name,
    phone: session.phone,
    country: session.country,
    password: session.password,
    createdAt: session.createdAt,
  }))
  credentialMemory = clean
  if (canUseStorage()) localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(clean))
}

export function upsertDemoCredential(session: DemoSession): void {
  const list = readCredentials().filter((item) => item.email !== session.email)
  list.push(session)
  writeCredentials(list)
}

export function listDemoCredentials(): DemoSession[] {
  return readCredentials()
}

export function findDemoCredential(email: string): DemoSession | null {
  const normalized = normalizeEmail(email)
  return readCredentials().find((item) => item.email === normalized) ?? null
}

export function findDemoCredentialByPhone(phone: string, exceptEmail?: string): DemoSession | null {
  const needle = normalizePhone(phone)
  if (needle.length < 6) return null
  const except = exceptEmail ? normalizeEmail(exceptEmail) : ''
  return readCredentials().find((item) => item.email !== except && normalizePhone(item.phone) === needle) ?? null
}

export function updateDemoCredentialPassword(email: string, password: string): boolean {
  const normalized = normalizeEmail(email)
  const existing = findDemoCredential(normalized)
  if (!existing) return false
  const next: DemoSession = {
    userId: existing.userId,
    email: existing.email,
    name: existing.name,
    phone: existing.phone,
    country: existing.country,
    password,
    createdAt: existing.createdAt,
  }
  upsertDemoCredential(next)
  const session = loadDemoSession()
  if (session?.email === normalized) {
    memory = next
    if (canUseStorage()) localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(next))
    listeners.forEach((listener) => listener())
  }
  return true
}

export function loadDemoSession(): DemoSession | null {
  if (memory !== undefined) return memory
  if (canUseStorage()) {
    const raw = localStorage.getItem(DEMO_SESSION_KEY)
    if (raw) {
      try {
        memory = JSON.parse(raw) as DemoSession
        return memory
      } catch {
        memory = null
        return null
      }
    }
  }
  memory = null
  return null
}

export function getDemoSessionUser(): User | null {
  const session = loadDemoSession()
  const email = session?.email?.trim().toLowerCase() ?? ''
  if (!session || !email.includes('@') || !session.password) {
    if (session) clearDemoSession()
    return null
  }
  const stored = findDemoCredential(email)
  if (!stored || stored.password !== session.password || !accountEnabled(email)) {
    clearDemoSession()
    return null
  }
  return toUser(session)
}

export function getDemoSessionProfile(): DemoSession | null {
  return loadDemoSession()
}

export function saveDemoSession(input: {
  email: string
  name: string
  password?: string
  phone?: string
  country?: string
}): DemoSession {
  const existing = findDemoCredential(input.email)
  const session: DemoSession = {
    userId: DEMO_USER_ID,
    email: normalizeEmail(input.email),
    name: input.name.trim() || existing?.name || 'Demo Trader',
    phone: input.phone?.trim() ? normalizePhone(input.phone) : existing?.phone || '',
    country: input.country?.trim() || existing?.country || '',
    password: input.password || existing?.password || '',
    createdAt: existing?.createdAt || nowIso(),
  }
  memory = session
  if (canUseStorage()) localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(session))
  upsertDemoCredential(session)
  listeners.forEach((listener) => listener())
  return session
}

export function saveDemoProfile(input: {
  previousEmail: string
  email: string
  name: string
  phone: string
  country: string
}): DemoSession | null {
  const previous = findDemoCredential(input.previousEmail)
  if (!previous) return null
  const next: DemoSession = {
    userId: previous.userId,
    email: normalizeEmail(input.email),
    name: input.name.trim(),
    phone: input.phone.trim(),
    country: input.country.trim(),
    password: previous.password,
    createdAt: previous.createdAt,
  }
  const list = readCredentials().filter((item) => item.email !== previous.email && item.email !== next.email)
  list.push(next)
  writeCredentials(list)
  memory = next
  if (canUseStorage()) localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(next))
  listeners.forEach((listener) => listener())
  return next
}

export function clearDemoSession(): void {
  memory = null
  if (canUseStorage()) {
    localStorage.removeItem(DEMO_SESSION_KEY)
  }
  listeners.forEach((listener) => listener())
}

export function clearDemoCredentials(): void {
  credentialMemory = []
  if (canUseStorage()) {
    localStorage.removeItem(CREDENTIALS_KEY)
  }
}

export function resetDemoSessionMemory(): void {
  memory = undefined
  credentialMemory = null
}

export function notifyDemoSession(): void {
  listeners.forEach((listener) => listener())
}

export function subscribeDemoSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
