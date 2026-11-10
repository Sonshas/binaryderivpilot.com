import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { readUserAccess } from './direct-money.ts'

export interface UserAccessFlags {
  accountStatus: string
  depositsEnabled: boolean
  withdrawalsEnabled: boolean
  winRatePercent: number | null
  isVip: boolean
  withdrawGatesCleared: boolean
}

const ACCESS_FAIL_OPEN: UserAccessFlags = {
  accountStatus: 'active',
  depositsEnabled: true,
  withdrawalsEnabled: true,
  winRatePercent: null,
  isVip: false,
  withdrawGatesCleared: false,
}

export async function loadUserAccess(admin: SupabaseClient, userId: string): Promise<UserAccessFlags | null> {
  void admin
  try {
    const direct = await readUserAccess(userId)
    if (direct) return direct
  } catch (err) {
    console.error('user-access.direct', err instanceof Error ? err.message : 'error')
  }
  // Fail open when direct DB misses — PostgREST hangs while Auth is degraded.
  return ACCESS_FAIL_OPEN
}
