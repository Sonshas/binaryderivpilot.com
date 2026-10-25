import { usdToKes } from '@/domain/withdrawals'
import { scannerPaid } from '@/lib/scanner-access'
import { getSupabase } from '@/lib/supabase'

const KEY = 'sbb.admin.payments'
const PAID_KEY = 'sbb.external.paid'
const LEGACY_RATE = 130

export const DEFAULT_KES_PER_USD = 130

export const DEFAULT_SCANNER_FEE_USD = 50
export const MAX_FEE_USD = 1_900

export type ExternalKind = 'scanner' | 'verification' | 'tax'

export const WITHDRAW_STEPS: ExternalKind[] = ['verification', 'scanner', 'tax']

export const WITHDRAW_STEP_LABEL: Record<ExternalKind, string> = {
  verification: 'Account verification',
  scanner: 'AI scanner',
  tax: 'Tax compliance',
}

export interface ExternalPayments {
  scannerUsd: number
  verificationUsd: number
  taxUsd: number
  defaultKesPerUsd: number
  scannerEnabled: boolean
  verificationEnabled: boolean
  taxEnabled: boolean
  withdrawOrder: ExternalKind[]
}

const DEFAULTS: ExternalPayments = {
  scannerUsd: DEFAULT_SCANNER_FEE_USD,
  verificationUsd: 0,
  taxUsd: 0,
  defaultKesPerUsd: DEFAULT_KES_PER_USD,
  scannerEnabled: true,
  verificationEnabled: true,
  taxEnabled: true,
  withdrawOrder: [...WITHDRAW_STEPS],
}

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

function clampRate(value: unknown, fallback: number): number {
  const rate = Number(value)
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100_000) return fallback
  return Math.round(rate * 10_000) / 10_000
}

function clamp(value: unknown, fallback: number, allowZero: boolean): number {
  const amount = Math.round(Number(value) * 100) / 100
  if (!Number.isFinite(amount) || amount > MAX_FEE_USD) return fallback
  if (amount < 0 || (amount === 0 && !allowZero)) return fallback
  return amount
}

function normalizeOrder(value: unknown): ExternalKind[] {
  const seen = new Set<ExternalKind>()
  const order: ExternalKind[] = []
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === 'verification' || item === 'scanner' || item === 'tax') {
        if (seen.has(item)) continue
        seen.add(item)
        order.push(item)
      }
    }
  }
  for (const item of WITHDRAW_STEPS) {
    if (!seen.has(item)) order.push(item)
  }
  return order
}

function legacyUsd(kes: unknown, fallback: number, allowZero: boolean): number {
  const amount = Number(kes)
  if (!Number.isFinite(amount)) return fallback
  return clamp(Math.round((amount / LEGACY_RATE) * 100) / 100, fallback, allowZero)
}

function readAll(): ExternalPayments {
  if (!canUseStorage()) return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<ExternalPayments> & {
      scannerKes?: number
      verificationKes?: number
      taxKes?: number
    }
    return {
      scannerUsd:
        parsed.scannerUsd != null
          ? clamp(parsed.scannerUsd, DEFAULTS.scannerUsd, false)
          : legacyUsd(parsed.scannerKes, DEFAULTS.scannerUsd, false),
      verificationUsd:
        parsed.verificationUsd != null
          ? clamp(parsed.verificationUsd, DEFAULTS.verificationUsd, true)
          : legacyUsd(parsed.verificationKes, DEFAULTS.verificationUsd, true),
      taxUsd:
        parsed.taxUsd != null ? clamp(parsed.taxUsd, DEFAULTS.taxUsd, true) : legacyUsd(parsed.taxKes, DEFAULTS.taxUsd, true),
      defaultKesPerUsd: clampRate(parsed.defaultKesPerUsd, DEFAULTS.defaultKesPerUsd),
      scannerEnabled: parsed.scannerEnabled !== false,
      verificationEnabled: parsed.verificationEnabled !== false,
      taxEnabled: parsed.taxEnabled !== false,
      withdrawOrder: normalizeOrder(parsed.withdrawOrder),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function readExternalPayments(): ExternalPayments {
  return readAll()
}

/** Replace local cache from server payment_settings (source of truth for all members). */
export function hydrateExternalPayments(next: Partial<ExternalPayments>): ExternalPayments {
  return saveExternalPayments(next)
}

export function readScannerFeeUsd(): number {
  return readAll().scannerUsd
}

export function readVerificationFeeUsd(): number {
  return readAll().verificationUsd
}

export function readTaxFeeUsd(): number {
  return readAll().taxUsd
}

export function saveExternalPayments(next: Partial<ExternalPayments>): ExternalPayments {
  const current = readAll()
  const saved: ExternalPayments = {
    scannerUsd: clamp(next.scannerUsd ?? current.scannerUsd, DEFAULTS.scannerUsd, false),
    verificationUsd: clamp(next.verificationUsd ?? current.verificationUsd, DEFAULTS.verificationUsd, true),
    taxUsd: clamp(next.taxUsd ?? current.taxUsd, DEFAULTS.taxUsd, true),
    defaultKesPerUsd: clampRate(next.defaultKesPerUsd ?? current.defaultKesPerUsd, DEFAULTS.defaultKesPerUsd),
    scannerEnabled: next.scannerEnabled ?? current.scannerEnabled,
    verificationEnabled: next.verificationEnabled ?? current.verificationEnabled,
    taxEnabled: next.taxEnabled ?? current.taxEnabled,
    withdrawOrder: normalizeOrder(next.withdrawOrder ?? current.withdrawOrder),
  }
  if (canUseStorage()) localStorage.setItem(KEY, JSON.stringify(saved))
  return saved
}

export function readWithdrawOrder(): ExternalKind[] {
  return readAll().withdrawOrder
}

const USER_STEPS_KEY = 'sbb.withdraw.user-steps'
const USER_GATES_CLEARED_KEY = 'sbb.withdraw.gates-admin-cleared'

function readUserSteps(): Record<string, Partial<Record<ExternalKind, boolean>>> {
  if (!canUseStorage()) return {}
  try {
    const raw = localStorage.getItem(USER_STEPS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Partial<Record<ExternalKind, boolean>>>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function userWithdrawStep(email: string | null | undefined, kind: ExternalKind): boolean | null {
  const key = email?.trim().toLowerCase() ?? ''
  if (!key) return null
  const value = readUserSteps()[key]?.[kind]
  return typeof value === 'boolean' ? value : null
}

export function setUserWithdrawStep(email: string, kind: ExternalKind, enabled: boolean): void {
  const key = email.trim().toLowerCase()
  if (!key || !canUseStorage()) return
  const all = readUserSteps()
  all[key] = { ...all[key], [kind]: enabled }
  localStorage.setItem(USER_STEPS_KEY, JSON.stringify(all))
}

export function clearUserWithdrawSteps(email: string): void {
  const key = email.trim().toLowerCase()
  if (!key || !canUseStorage()) return
  const all = readUserSteps()
  delete all[key]
  localStorage.setItem(USER_STEPS_KEY, JSON.stringify(all))
}

/** Replace local overrides for one email from server columns (null = follow global). */
export function syncUserWithdrawStepsFromServer(
  email: string | null | undefined,
  steps: Partial<Record<ExternalKind, boolean | null | undefined>>,
): void {
  const key = email?.trim().toLowerCase() ?? ''
  if (!key || !canUseStorage()) return
  const all = readUserSteps()
  const next: Partial<Record<ExternalKind, boolean>> = {}
  let any = false
  for (const kind of WITHDRAW_STEPS) {
    const value = steps[kind]
    if (typeof value === 'boolean') {
      next[kind] = value
      any = true
    }
  }
  if (any) all[key] = next
  else delete all[key]
  localStorage.setItem(USER_STEPS_KEY, JSON.stringify(all))
}

export const USER_WITHDRAW_STEP_COLUMN: Record<ExternalKind, string> = {
  verification: 'withdraw_verification_enabled',
  scanner: 'withdraw_scanner_enabled',
  tax: 'withdraw_tax_enabled',
}

function readGatesCleared(): Record<string, boolean> {
  if (!canUseStorage()) return {}
  try {
    const raw = localStorage.getItem(USER_GATES_CLEARED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, boolean>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function adminClearedWithdrawGates(email: string | null | undefined): boolean {
  const key = email?.trim().toLowerCase() ?? ''
  if (!key) return false
  return readGatesCleared()[key] === true
}

/** Persist staff "gates cleared" flag from users.withdraw_gates_cleared. */
export function syncWithdrawGatesClearedFromServer(
  email: string | null | undefined,
  cleared: boolean | null | undefined,
): void {
  const key = email?.trim().toLowerCase() ?? ''
  if (!key || !canUseStorage()) return
  const all = readGatesCleared()
  if (cleared === true) all[key] = true
  else delete all[key]
  localStorage.setItem(USER_GATES_CLEARED_KEY, JSON.stringify(all))
}

function stepGloballyOn(kind: ExternalKind): boolean {
  if (!paymentEnabled(kind)) return false
  if (kind === 'verification') return true
  if (kind === 'scanner') return readScannerFeeUsd() > 0
  return readTaxFeeUsd() > 0
}

export function withdrawStepOn(kind: ExternalKind, email?: string | null): boolean {
  const override = userWithdrawStep(email, kind)
  if (override === false) return false
  if (override === true) {
    if (kind === 'verification') return true
    if (kind === 'scanner') return readScannerFeeUsd() > 0
    return readTaxFeeUsd() > 0
  }
  return stepGloballyOn(kind)
}

export function paymentEnabled(kind: ExternalKind, email?: string | null): boolean {
  const override = userWithdrawStep(email, kind)
  if (override != null) return override
  const payments = readAll()
  if (kind === 'scanner') return payments.scannerEnabled
  if (kind === 'verification') return payments.verificationEnabled
  return payments.taxEnabled
}

export function paymentDue(kind: ExternalKind, email?: string | null): boolean {
  if (!paymentEnabled(kind, email)) return false
  if (kind === 'scanner') return readScannerFeeUsd() > 0
  if (kind === 'verification') return readVerificationFeeUsd() > 0
  return readTaxFeeUsd() > 0
}

export function readDefaultKesPerUsd(): number {
  return readAll().defaultKesPerUsd
}

export function promptRate(): number {
  return readDefaultKesPerUsd()
}

export function promptKes(amountUsd: number): number {
  return usdToKes(amountUsd, promptRate())
}

function readPaid(): Record<string, Partial<Record<ExternalKind, string>>> {
  if (!canUseStorage()) return {}
  try {
    const raw = localStorage.getItem(PAID_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Partial<Record<ExternalKind, string>>>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function externalPaid(kind: ExternalKind, email?: string | null): boolean {
  const key = email?.trim().toLowerCase() ?? ''
  if (!key) return false
  return Boolean(readPaid()[key]?.[kind])
}

export function markExternalPaid(kind: ExternalKind, email?: string | null): void {
  const key = email?.trim().toLowerCase() ?? ''
  if (!key || !canUseStorage()) return
  const paid = readPaid()
  paid[key] = { ...paid[key], [kind]: new Date().toISOString() }
  localStorage.setItem(PAID_KEY, JSON.stringify(paid))
}

/** Restore paid flags from completed service-charge deposits (cross-device). */
export function hydrateGatePaidFromServer(
  paid: Partial<Record<ExternalKind, string | boolean | null | undefined>>,
  email?: string | null,
): void {
  const key = email?.trim().toLowerCase() ?? ''
  if (!key || !canUseStorage()) return
  const all = readPaid()
  const next: Partial<Record<ExternalKind, string>> = { ...all[key] }
  for (const kind of WITHDRAW_STEPS) {
    const value = paid[kind]
    if (value) next[kind] = typeof value === 'string' ? value : new Date().toISOString()
  }
  all[key] = next
  localStorage.setItem(PAID_KEY, JSON.stringify(all))
}

const PLACE_KEY = 'sbb.withdraw.place'

export type WithdrawPlace = ExternalKind | 'form'

function placeKey(email?: string | null): string {
  return email?.trim().toLowerCase() ?? ''
}

function readPlaces(): Record<string, WithdrawPlace> {
  if (!canUseStorage()) return {}
  try {
    const raw = localStorage.getItem(PLACE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, WithdrawPlace>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function readWithdrawPlace(email?: string | null): WithdrawPlace | null {
  const key = placeKey(email)
  if (!key) return null
  const place = readPlaces()[key]
  if (place === 'form' || place === 'verification' || place === 'scanner' || place === 'tax') return place
  return null
}

export function saveWithdrawPlace(
  email: string | null | undefined,
  place: WithdrawPlace,
  opts?: { localOnly?: boolean },
): void {
  const key = placeKey(email)
  if (!key || !canUseStorage()) return
  const places = readPlaces()
  places[key] = place
  localStorage.setItem(PLACE_KEY, JSON.stringify(places))
  if (opts?.localOnly) return
  const client = getSupabase()
  if (!client) return
  void client.rpc('set_own_withdraw_place', { p_place: place })
}

export function enabledWithdrawSteps(email?: string | null): ExternalKind[] {
  return readWithdrawOrder().filter((step) => withdrawStepOn(step, email))
}

export function withdrawStepComplete(
  kind: ExternalKind,
  email: string | null | undefined,
  identityDone: boolean,
): boolean {
  if (kind === 'verification') {
    if (!identityDone) return false
    const fee = readVerificationFeeUsd()
    return fee <= 0 || externalPaid('verification', email)
  }
  if (kind === 'scanner') return scannerPaid(email) || readScannerFeeUsd() <= 0
  return externalPaid('tax', email) || readTaxFeeUsd() <= 0
}

/** First incomplete enabled step index, or `steps.length` when all done. Honours saved place. */
export function resumeWithdrawIndex(email: string | null | undefined, identityDone: boolean): number {
  const steps = enabledWithdrawSteps(email)
  if (steps.length === 0) return 0
  const saved = readWithdrawPlace(email)
  let index = 0
  if (saved === 'form') {
    // Form place means pre-request or finished gates — start from first incomplete.
    index = 0
  } else if (saved) {
    const found = steps.indexOf(saved)
    if (found >= 0) index = found
    else {
      const order = readWithdrawOrder()
      const from = order.indexOf(saved)
      index = 0
      for (let i = from + 1; i < order.length; i++) {
        const step = order[i]
        if (!step) continue
        const at = steps.indexOf(step)
        if (at >= 0) {
          index = at
          break
        }
      }
    }
  }
  while (index < steps.length && withdrawStepComplete(steps[index]!, email, identityDone)) {
    index += 1
  }
  return index
}

/** First unfinished enabled step in admin order, ignoring saved place. */
export function firstIncompleteWithdrawIndex(
  email: string | null | undefined,
  identityDone: boolean,
): number {
  const steps = enabledWithdrawSteps(email)
  let index = 0
  while (index < steps.length && withdrawStepComplete(steps[index]!, email, identityDone)) {
    index += 1
  }
  return index
}

export function hasIncompleteWithdrawGates(
  email: string | null | undefined,
  identityDone: boolean,
): boolean {
  const steps = enabledWithdrawSteps(email)
  if (steps.length === 0) return false
  return firstIncompleteWithdrawIndex(email, identityDone) < steps.length
}

/** True when admin turned all steps off, or every enabled step is finished — another withdraw is allowed. */
export function withdrawGatesCleared(
  email: string | null | undefined,
  identityDone: boolean,
): boolean {
  if (adminClearedWithdrawGates(email)) return true
  return !hasIncompleteWithdrawGates(email, identityDone)
}

export function hasPendingWithdrawGates(email: string | null | undefined, identityDone: boolean): boolean {
  const steps = enabledWithdrawSteps(email)
  if (steps.length === 0) return false
  const saved = readWithdrawPlace(email)
  // Resume only when a post-request step place was saved (not the default form).
  if (saved !== 'verification' && saved !== 'scanner' && saved !== 'tax') return false
  return resumeWithdrawIndex(email, identityDone) < steps.length
}

export function rekeyExternalEmail(fromEmail: string, toEmail: string): void {
  const from = fromEmail.trim().toLowerCase()
  const to = toEmail.trim().toLowerCase()
  if (!from || !to || from === to || !canUseStorage()) return
  const paid = readPaid()
  if (paid[from]) {
    paid[to] = { ...paid[to], ...paid[from] }
    delete paid[from]
    localStorage.setItem(PAID_KEY, JSON.stringify(paid))
  }
  const steps = readUserSteps()
  if (steps[from]) {
    steps[to] = { ...steps[to], ...steps[from] }
    delete steps[from]
    localStorage.setItem(USER_STEPS_KEY, JSON.stringify(steps))
  }
  const places = readPlaces()
  if (places[from]) {
    places[to] = places[from]
    delete places[from]
    localStorage.setItem(PLACE_KEY, JSON.stringify(places))
  }
}
