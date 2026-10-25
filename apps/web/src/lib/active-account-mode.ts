import type { AccountMode } from '@/types'

let active: AccountMode = 'demo'

export function setActiveAccountMode(mode: AccountMode): void {
  active = mode
}

export function getActiveAccountMode(): AccountMode {
  return active
}
