import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { ttlPartitionHealthConfig } from '@/lib/query-config/system/ttl-partition-health'

function TtlPartitionHealthPageContent() {
  return (
    <PageLayout
      queryConfig={ttlPartitionHealthConfig}
      title="TTL & Partition Health"
      description="Inventory of MergeTree TTL and PARTITION BY, with partition and part counts and a recommend-only next-step column. Tables without TTL still appear. Highlighted rows have too many partitions or a time-based partition key with no TTL. Recommend-only — this page does not run ALTER TTL or DROP PARTITION. Related: Storage Economics, Advisor Schema & Settings, and the disk-capacity forecast in the agent."
    />
  )
}

function TtlPartitionHealthPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TtlPartitionHealthPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/ttl-partition-health')({
  component: TtlPartitionHealthPage,
  head: () => pageOgHead('ttl-partition-health'),
})
