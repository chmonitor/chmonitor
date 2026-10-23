import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { ReplicationNotUsed } from '@/components/replication/replication-not-used'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { replicationQueueConfig } from '@/lib/query-config/tables/replication-queue'
import { useHostId } from '@/lib/swr'
import { useReplicationUsed } from '@/lib/swr/use-replication-usage'

function ReplicationQueuePageContent() {
  const used = useReplicationUsed(useHostId())
  if (used === false) return <ReplicationNotUsed />
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
