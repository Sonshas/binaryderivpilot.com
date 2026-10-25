import { winningDigitCountForPercent } from '@/domain/outcome/win-rate'
import type { PanelAuditRow, PanelUser } from '@/services/admin-panel'

export const MAX_SIMULATED_BALANCE = 1_000_000_000

/** "95" / "95.5%" → 95 / 95.5. Null unless 0–100. */
export function parsePercentInput(value: string): number | null {
  const cleaned = value.trim().replace(/%$/, '').trim()
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n * 100) / 100
}

export function formatPercent(percent: number | null | undefined): string {
  if (percent == null || !Number.isFinite(percent)) return '—'
  return `${Math.round(percent * 100) / 100}%`
}

/** Demo outcomes use whole winning digits, so a rate settles as round(rate / 10) of 10 digits. */
export function settledPercent(percent: number): number {
  return winningDigitCountForPercent(percent) * 10
}

/** "$1,234.5" → 1234.5. Null unless 0 – MAX_SIMULATED_BALANCE. */
export function parseBalanceInput(value: string): number | null {
  const cleaned = value.trim().replace(/[$,\s]/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0 || n > MAX_SIMULATED_BALANCE) return null
  return Math.round(n * 100) / 100
}

export function filterPanelUsers(users: readonly PanelUser[], query: string): PanelUser[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...users]
  return users.filter((u) => (u.email ?? '').toLowerCase().includes(q) || u.id.toLowerCase().startsWith(q) || u.role.toLowerCase() === q)
}

const ACTION_LABELS: Record<string, string> = {
  'simulated_balance.set': 'Set demo balance',
  'win_rate.global_set': 'Set global demo win rate',
  'win_rate.user_set': 'Set user demo win rate',
  'win_rate.user_clear': 'User demo win rate → global',
}

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

export function auditValue(row: PanelAuditRow, which: 'old' | 'new'): string {
  const value = which === 'old' ? row.oldValue : row.newValue
  if (row.action.startsWith('win_rate.')) return value == null ? 'global' : formatPercent(value)
  return value == null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
