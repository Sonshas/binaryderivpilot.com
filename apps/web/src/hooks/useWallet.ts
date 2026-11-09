import { useEffect, useState } from 'react'
import {
  REAL_BALANCE_LOADING,
  REAL_BALANCE_PLACEHOLDER,
  authConnectionStatus,
  buildRealAccountView,
} from '@/domain/account'
import { useAuthSession } from '@/hooks/useAuth'
import { formatMoney } from '@/lib/format'
import { loadDemoState, subscribeDemoStore } from '@/lib/demo-store'
import { notifyRealWalletChanged, subscribeRealWalletChanged } from '@/lib/real-wallet-events'
import { isOpenWithdrawalStatus } from '@/domain/withdrawals'
import { REAL_INTEGRATION } from '@/providers/config'
import { walletService } from '@/services/wallet'
import { WITHDRAWAL_POLL_MS, withdrawalService } from '@/services/withdrawals'
import type { AccountMode, Deposit, Transaction, Wallet, Withdrawal } from '@/types'
import { demoAccountUpper } from '@/lib/branding'

const REAL_WALLET_CACHE_KEY = 'sbb:real-wallet-v1'

function useRealWalletRefreshKey(kind: AccountMode): number {
  const [key, setKey] = useState(0)
  useEffect(() => {
    if (kind !== 'real') return
    return subscribeRealWalletChanged(() => setKey((k) => k + 1))
  }, [kind])
  return key
}

function readDemoWallet(): Wallet {
  return loadDemoState().wallet
}

function readDemoHistory(): {
  transactions: Transaction[]
  deposits: Deposit[]
  withdrawals: Withdrawal[]
} {
  const state = loadDemoState()
  return {
    transactions: state.transactions,
    deposits: state.deposits,
    withdrawals: state.withdrawals,
  }
}

function readCachedRealWallet(userId: string | undefined): Wallet | null {
  if (!userId) return null
  try {
    const raw = sessionStorage.getItem(REAL_WALLET_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { userId?: string; wallet?: Wallet; at?: number }
    if (parsed.userId !== userId || !parsed.wallet) return null
    if (typeof parsed.at === 'number' && Date.now() - parsed.at > 30 * 60_000) return null
    return parsed.wallet
  } catch {
    return null
  }
}

function writeCachedRealWallet(userId: string, wallet: Wallet) {
  try {
    sessionStorage.setItem(
      REAL_WALLET_CACHE_KEY,
      JSON.stringify({ userId, wallet, at: Date.now() }),
    )
  } catch {
    /* private mode */
  }
}

export function useWallet(kind: AccountMode) {
  const { isSignedIn, user } = useAuthSession()
  const [demoWallet, setDemoWallet] = useState<Wallet>(() => readDemoWallet())
  const [realWallet, setRealWallet] = useState<Wallet | null>(() =>
    kind === 'real' ? readCachedRealWallet(user?.id) : null,
  )
  const [message, setMessage] = useState('')
  const cached = kind === 'real' ? readCachedRealWallet(user?.id) : null
  const [loading, setLoading] = useState(kind === 'real' && !cached)
  const [walletConnected, setWalletConnected] = useState(
    () =>
      Boolean(
        cached &&
          !cached.isSimulated &&
          cached.availableBalance != null &&
          (cached.status === 'ready' || cached.status === 'empty'),
      ),
  )
  const refreshKey = useRealWalletRefreshKey(kind)

  useEffect(() => {
    if (kind !== 'demo') return
    const refresh = () => setDemoWallet(readDemoWallet())
    refresh()
    setMessage(`${demoAccountUpper()} wallet — simulated virtual funds, not real money.`)
    setLoading(false)
    return subscribeDemoStore(refresh)
  }, [kind])

  useEffect(() => {
    if (kind !== 'real') return
    let cancelled = false
    const hadCache = Boolean(realWallet)
    if (refreshKey === 0 && !hadCache) {
      setLoading(true)
      setWalletConnected(false)
    }
    void walletService
      .getWallet('real')
      .then((result) => {
        if (cancelled) return
        setRealWallet(result.data)
        const readable =
          Boolean(result.connected) &&
          result.data != null &&
          !result.data.isSimulated &&
          result.data.availableBalance != null &&
          (result.data.status === 'ready' || result.data.status === 'empty')
        setWalletConnected(readable)
        setMessage(result.message)
        if (readable && result.data && user?.id) {
          writeCachedRealWallet(user.id, result.data)
        }
      })
      .catch(() => {
        if (cancelled) return
        if (!hadCache) {
          setRealWallet(null)
          setWalletConnected(false)
        }
        setMessage('Real wallet could not be loaded. Please try again later.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, isSignedIn, user?.id, refreshKey])

  if (kind === 'demo') {
    return {
      wallet: demoWallet,
      message,
      loading: false,
      balanceDisplay: formatMoney(demoWallet.availableBalance ?? 0),
      authStatus: authConnectionStatus(isSignedIn),
      userEmail: user?.email ?? null,
    }
  }

  const view = buildRealAccountView(REAL_INTEGRATION)
  const authStatus = authConnectionStatus(isSignedIn)
  const connectedBalance =
    walletConnected && realWallet?.availableBalance != null
      ? formatMoney(realWallet.availableBalance, realWallet.currency || 'USD')
      : !isSignedIn
        ? '—'
        : loading
          ? REAL_BALANCE_LOADING
          : REAL_BALANCE_PLACEHOLDER
  return {
    wallet: realWallet,
    message,
    loading,
    balanceDisplay: connectedBalance,
    authStatus,
    userEmail: user?.email ?? null,
    realView: {
      ...view,
      balanceDisplay: connectedBalance,
      label: authStatus,
    },
  }
}

export function useWalletHistory(kind: AccountMode, enabled = true) {
  const { isSignedIn, user } = useAuthSession()
  const [demoHistory, setDemoHistory] = useState(() => readDemoHistory())
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(kind === 'real' && enabled)
  const [message, setMessage] = useState('')
  const refreshKey = useRealWalletRefreshKey(kind)

  useEffect(() => {
    if (kind !== 'demo') return
    const refresh = () => setDemoHistory(readDemoHistory())
    refresh()
    setLoading(false)
    return subscribeDemoStore(refresh)
  }, [kind])

  useEffect(() => {
    if (kind !== 'real' || !enabled) {
      if (!enabled) setLoading(false)
      return
    }
    let cancelled = false
    if (refreshKey === 0) {
      setLoading(true)
    }
    void Promise.all([
      walletService.listTransactions('real'),
      walletService.listDeposits('real'),
      walletService.listWithdrawals('real'),
    ]).then(([tx, dep, wd]) => {
      if (!cancelled) {
        setTransactions(tx.data)
        setDeposits(dep.data)
        setWithdrawals(wd.data)
        setMessage(tx.message)
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) {
        setLoading(false)
        setMessage('Real deposits and withdrawals could not be loaded. Please try again later.')
      }
    })
    return () => {
      cancelled = true
    }
  }, [kind, isSignedIn, user?.id, refreshKey, enabled])

  const hasOpenWithdrawal = kind === 'real' && withdrawals.some((w) => isOpenWithdrawalStatus(w.status))
  useEffect(() => {
    if (kind !== 'real' || !user?.id || !enabled) return
    return withdrawalService.subscribe(user.id, notifyRealWalletChanged, {
      channel: `wallet-history:${user.id}`,
      pollMs: hasOpenWithdrawal ? WITHDRAWAL_POLL_MS : 0,
    })
  }, [kind, user?.id, hasOpenWithdrawal, enabled])

  if (kind === 'demo') {
    return {
      transactions: demoHistory.transactions,
      deposits: demoHistory.deposits,
      withdrawals: demoHistory.withdrawals,
      loading: false,
      message: `${demoAccountUpper()} transactions. Simulated ledger only.`,
    }
  }

  return { transactions, deposits, withdrawals, loading, message }
}
