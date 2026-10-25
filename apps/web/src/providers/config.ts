import type { RealCapabilityMap } from '@/types'
import { isMarketDataProviderConfigured } from '@/providers/market-data/env'

export const REAL_INTEGRATION: RealCapabilityMap = {
  backendConfigured: true,
  get marketDataConfigured() {
    return isMarketDataProviderConfigured()
  },
  executionConfigured: true,
  paymentConfigured: true,
  depositsConfigured: true,
  withdrawalsConfigured: true,
  complianceConfigured: false,
}

export const DEMO_STARTING_BALANCE = 10_000
export const DEMO_STORAGE_KEY = 'sbb.demo.v1'
export const DEMO_SESSION_KEY = 'sbb.demo.session'
export const ACCOUNT_MODE_STORAGE_KEY = 'sbb.accountMode'
export const ACCOUNT_MODE_BY_USER_KEY = 'sbb.accountModeByUser'
