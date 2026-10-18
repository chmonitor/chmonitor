import { createFileRoute } from '@tanstack/react-router'

import { lazy, Suspense } from 'react'
import { TableSkeleton } from '@/components/skeletons'
import { TableClient } from '@/components/tables/table-client'
import { Skeleton } from '@/components/ui/skeleton'
import { queryConfig } from '@/lib/api/clusters-api'
import { pageOgHead } from '@/lib/og'
import { useHostId } from '@/lib/swr'

// Lazy-load the topology SVG — it's a large chunk and must not SSR.
const TopologyView = lazy(() =>
  import('@/components/cluster-topology').then((m) => ({
    default: m.TopologyView,
  }))
)

function TopologySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_360px]">
      <Skeleton className="h-[540px] w-full rounded-xl" />
      <Skeleton className="h-[540px] w-full rounded-xl" />
    </div>
  )
}

function ClustersPage() {
  const hostId = useHostId()

  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<TopologySkeleton />}>
        <TopologyView hostId={hostId} />
      </Suspense>

      <Suspense fallback={<TableSkeleton />}>
        <TableClient
          title={queryConfig.name}
          description={queryConfig.description}
          queryConfig={queryConfig}
        />
      </Suspense>
    </div>
  )
}

export const Route = createFileRoute('/(dashboard)/clusters/')({
  component: ClustersPage,
  head: () => pageOgHead('clusters'),
})
