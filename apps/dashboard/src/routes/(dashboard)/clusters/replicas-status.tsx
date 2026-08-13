import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { ReadonlyTablesWarning } from '@/components/clusters/readonly-tables-warning'
import { TableSkeleton } from '@/components/skeletons'
import { TableClient } from '@/components/tables/table-client'
import { AppLink as Link } from '@/components/ui/app-link'
import { clustersReplicasStatusConfig } from '@/lib/query-config/system/replicas-status'
import { useHostId } from '@/lib/swr'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'

function ReplicasStatusContent() {
  const searchParams = useUrlSearchParams()
  const hostId = useHostId()
  const cluster = searchParams.get('cluster')

  const clustersUrl = `/clusters?host=${hostId}`

  return (
    <div className="flex flex-col gap-4">
      {/* Table Content */}
      {cluster ? (
        <>
          {/* Readonly tables warning indicator */}
          <ReadonlyTablesWarning hostId={hostId} cluster={cluster} />

          <Suspense fallback={<TableSkeleton />}>
            <TableClient
              title={`Replicas Status: ${cluster}`}
              description={clustersReplicasStatusConfig.description}
              queryConfig={clustersReplicasStatusConfig}
              searchParams={{ cluster }}
            />
          </Suspense>
        </>
      ) : (
        <div className="bg-card flex h-96 items-center justify-center rounded-lg border">
          <p className="text-muted-foreground text-sm">
            Select a cluster from the{' '}
            <Link href={clustersUrl} className="text-primary hover:underline">
              clusters list
            </Link>{' '}
            to view replicas status.
          </p>
        </div>
      )}
    </div>
  )
}

function ClusterReplicasStatusPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <ReplicasStatusContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/clusters/replicas-status')({
  component: ClusterReplicasStatusPage,
})
