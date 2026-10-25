import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Logo } from '@/components/brand/Logo'
import { ProgressLoader } from '@/components/ProgressLoader'
import { useAuthSession } from '@/hooks/useAuth'
import { resolvePostAuthPath } from '@/lib/auth-redirect'

function AuthShell({ allowSignedIn = false }: { allowSignedIn?: boolean }) {
  const { isSignedIn, loading } = useAuthSession()
  const location = useLocation()

  if (loading) {
    return (
      <ProgressLoader label="Checking your session" />
    )
  }

  if (isSignedIn && !allowSignedIn) {
    return <Navigate to={resolvePostAuthPath(location.search, location.state)} replace />
  }

  return (
    <div className="min-h-svh bg-ink sbb-glow">
      <div className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Outlet />
      </div>
    </div>
  )
}

export function AuthLayout() {
  return <AuthShell />
}

export function AuthCallbackLayout() {
  return <AuthShell allowSignedIn />
}
