import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface UserAccessFlags {
  accountStatus: string
  depositsEnabled: boolean
  withdrawalsEnabled: boolean
  winRatePercent: number | null
  isVip: boolean
  withdrawGatesCleared: boolean
}

export async function loadUserAccess(admin: SupabaseClient, userId: string): Promise<UserAccessFlags | null> {
  const { data, error } = await admin
    .from('users')
    .select(
      'account_status, deposits_enabled, withdrawals_enabled, win_rate_percent, is_vip, withdraw_gates_cleared',
    )
    .eq('id', userId)
    .maybeSingle()
  if (error || !data) return null
  return {
    accountStatus: String(data.account_status ?? 'active'),
    depositsEnabled: data.deposits_enabled !== false,
    withdrawalsEnabled: data.withdrawals_enabled !== false,
    winRatePercent: data.win_rate_percent == null ? null : Number(data.win_rate_percent),
    isVip: data.is_vip === true,
    withdrawGatesCleared: data.withdraw_gates_cleared === true,
  }
}
