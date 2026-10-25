import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { RequireAuth } from '@/components/RequireAuth'
import { RequireStaff } from '@/components/RequireStaff'
import { RequireSuperadmin } from '@/components/RequireSuperadmin'
import { SuperAdminPanel } from '@/features/admin/SuperAdminPanel'
import { TRADE_ROUTE } from '@/lib/auth-redirect'
import { AuthProvider } from '@/hooks/useAuth'
import { AccountModeProvider } from '@/hooks/useAccountMode'
import { AdminLayout } from '@/layouts/AdminLayout'
import { AppLayout } from '@/layouts/AppLayout'
import { AuthCallbackLayout, AuthLayout } from '@/layouts/AuthLayout'
import { PublicLayout } from '@/layouts/PublicLayout'
import { ConfirmEmailPage } from '@/pages/auth/ConfirmEmailPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import { SignupPage } from '@/pages/auth/SignupPage'
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage'
import {
  AdminAuditPage,
  AdminDashboardPage,
  AdminSystemPage,
  AdminDepositsPage,
  AdminFeesPage,
  AdminLedgerPage,
  AdminMarketsPage,
  AdminMegapayPage,
  AdminNotificationsPage,
  AdminStkQueuePage,
  AdminSupportPage,
  AdminTradesPage,
  AdminTradeSettingsRoute,
  AdminUsersPage,
  AdminVerificationPage,
  AdminWithdrawalsPage,
  AdminWithdrawControlsPage,
} from '@/pages/admin/AdminPages'
import { NotificationsPage } from '@/pages/account/NotificationsPage'
import { ProfilePage } from '@/pages/account/ProfilePage'
import { SupportPage } from '@/pages/account/SupportPage'
import { DisclosurePage } from '@/pages/legal/LegalPages'
import { LandingPage } from '@/pages/LandingPage'
import { OfflineGate } from '@/components/OfflineGate'
import { RouteProgress } from '@/components/ProgressLoader'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { StatusErrorPage } from '@/pages/errors/ErrorPage'
import { TradeHistoryPage } from '@/pages/trading/TradeHistoryPage'
import { TradingPage } from '@/pages/trading/TradingPage'
import { TransactionsPage } from '@/pages/wallet/TransactionsPage'
function RedirectToTrade() {
  const { search, hash } = useLocation()
  return <Navigate to={`${TRADE_ROUTE}${search}${hash}`} replace />
}

export default function App() {
  return (
    <AuthProvider>
    <AccountModeProvider>
    <OfflineGate>
      <RouteProgress />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/disclosure" element={<DisclosurePage />} />
        </Route>

        <Route path="/400" element={<StatusErrorPage kind="400" />} />
        <Route path="/401" element={<StatusErrorPage kind="401" />} />
        <Route path="/403" element={<StatusErrorPage kind="403" />} />
        <Route path="/404" element={<NotFoundPage />} />
        <Route path="/408" element={<StatusErrorPage kind="408" />} />
        <Route path="/429" element={<StatusErrorPage kind="429" />} />
        <Route path="/500" element={<StatusErrorPage kind="500" />} />
        <Route path="/502" element={<StatusErrorPage kind="502" />} />
        <Route path="/503" element={<StatusErrorPage kind="503" />} />
        <Route path="/504" element={<StatusErrorPage kind="504" />} />
        <Route path="/offline" element={<StatusErrorPage kind="offline" />} />
        <Route path="*" element={<NotFoundPage />} />

        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/register" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
        </Route>

        <Route element={<AuthCallbackLayout />}>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/auth/confirm" element={<ConfirmEmailPage />} />
        </Route>

        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<RedirectToTrade />} />
          <Route path="trade" element={<TradingPage />} />
          <Route path="history" element={<TradeHistoryPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="support" element={<SupportPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFoundPage inset homeHref="/app/trade" homeLabel="Back to trade" />} />
        </Route>

        <Route
          path="/admin"
          element={
            <RequireStaff>
              <AdminLayout />
            </RequireStaff>
          }
        >
          <Route index element={<AdminDashboardPage />} />
          <Route path="dashboard" element={<Navigate to="/admin" replace />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route
            path="superadmin"
            element={
              <RequireSuperadmin>
                <SuperAdminPanel />
              </RequireSuperadmin>
            }
          />
          <Route path="verification" element={<AdminVerificationPage />} />
          <Route path="deposits" element={<AdminDepositsPage />} />
          <Route path="system" element={<AdminSystemPage />} />
          <Route path="withdrawals" element={<AdminWithdrawalsPage />} />
          <Route path="withdraw-controls" element={<AdminWithdrawControlsPage />} />
          <Route path="trade-settings" element={<AdminTradeSettingsRoute />} />
          <Route path="fees" element={<AdminFeesPage />} />
          <Route path="paymode" element={<Navigate to="/admin/fees" replace />} />
          <Route path="trades" element={<AdminTradesPage />} />
          <Route path="ledger" element={<AdminLedgerPage />} />
          <Route path="support" element={<AdminSupportPage />} />
          <Route path="notifications" element={<AdminNotificationsPage />} />
          <Route path="audit" element={<AdminAuditPage />} />
          <Route path="markets" element={<AdminMarketsPage />} />
          <Route path="stk-queue" element={<AdminStkQueuePage />} />
          <Route path="megapay" element={<AdminMegapayPage />} />
          <Route path="accounts" element={<Navigate to="/admin/users" replace />} />
          <Route path="service-fees" element={<Navigate to="/admin/deposits" replace />} />
          <Route path="log" element={<Navigate to="/admin/system" replace />} />
          <Route path="settings" element={<Navigate to="/admin/fees" replace />} />
          <Route path="*" element={<NotFoundPage inset homeHref="/admin" homeLabel="Back to admin" />} />
        </Route>

        <Route path="/trade" element={<RedirectToTrade />} />
      </Routes>
    </OfflineGate>
    </AccountModeProvider>
    </AuthProvider>
  )
}
