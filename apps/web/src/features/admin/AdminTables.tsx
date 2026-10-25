import { Alert, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui'
import type { ReactNode } from 'react'

export function AdminTablePage({
  title,
  subtitle,
  loading,
  message,
  children,
}: {
  title: string
  subtitle: string
  loading?: boolean
  message?: string
  children?: ReactNode
}) {
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      {message ? <Alert tone="mist">{message}</Alert> : null}
      <Card className="mt-4">
        {loading ? <Skeleton className="h-40" /> : (children ?? (
          <EmptyState title="No records" body="This list is empty until a real admin API is connected. Production data was not loaded." />
        ))}
      </Card>
    </div>
  )
}
