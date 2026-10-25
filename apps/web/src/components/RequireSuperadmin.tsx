import type { ReactNode } from 'react'
import { ProgressLoader } from '@/components/ProgressLoader'
import { Alert, PageHeader } from '@/components/ui'
import { useSuperadmin } from '@/hooks/useSuperadmin'

/** UI gate only; the admin-panel Edge Function and admin_* RPCs enforce the superadmin check. */
export function RequireSuperadmin({ children }: { children: ReactNode }) {
  const state = useSuperadmin()
  if (state === 'checking') return <ProgressLoader label="Checking access" />
  if (state === 'no') {
    return (
      <div data-testid="superadmin-denied">
        <PageHeader title="Superadmin" />
        <Alert tone="danger">This section is limited to the superadmin account.</Alert>
      </div>
    )
  }
  return children
}
