import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ProgressLoader } from '@/components/ProgressLoader'
import { useAuthSession } from '@/hooks/useAuth'
import { isAdminEmail } from '@/lib/admin-emails'

function StaffGate() {
  return <ProgressLoader label="Opening admin" />
}

export function RequireStaff({ children }: { children: ReactNode }) {
  const { user, isSignedIn, loading, authService } = useAuthSession()
  const navigate = useNavigate()
  const [kicking, setKicking] = useState(false)
  const allowed = isAdminEmail(user?.email)

  useEffect(() => {
    if (loading || !isSignedIn || allowed) return
    let cancelled = false
    setKicking(true)
    void authService.signOut().then(() => {
      if (!cancelled) navigate('/login', { replace: true })
    })
    return () => {
      cancelled = true
    }
  }, [loading, isSignedIn, allowed, authService, navigate])

  if (loading) return <StaffGate />

  if (!isSignedIn) return <Navigate to="/login" replace />

  if (!allowed || kicking) return <ProgressLoader label="Signing out" />

  return children
}
