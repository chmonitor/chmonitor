import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { replicationQueueConfig } from '@/lib/query-config/tables/replication-queue'

function ReplicationQueuePageContent() {
  return (
    <PageLayout
      queryConfig={replicationQueueConfig}
      title="Replication Queue"
    />
  )
}

function ReplicationQueuePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReplicationQueuePageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/replication-queue')({
  component: ReplicationQueuePage,
  head: () => pageOgHead('replication-queue'),
})
