import { DatabaseIcon, SquareTerminal } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import type { ApiResponseMetadata } from '@/lib/api/types'

import {
  type DependencyEdge,
  DependencyGraph,
} from './dependency-graph/dependency-graph'
import { useExplorerState } from './hooks/use-explorer-state'
import { CardToolbar } from '@/components/cards/card-toolbar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'

interface ApiResponse<T> {
  data: T
  metadata?: ApiResponseMetadata
}

const fetcher = async <T,>(url: string): Promise<ApiResponse<T>> => {
  const res = await apiFetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch dependencies: ${res.statusText}`)
  }
  return res.json() as Promise<ApiResponse<T>>
}

interface DatabaseOverviewProps {
  database: string
}

export function DatabaseOverview({ database }: DatabaseOverviewProps) {
  const hostId = useHostId()
  const { setTab } = useExplorerState()

  const depsUrl = `/api/v1/explorer/dependencies?hostId=${hostId}&database=${encodeURIComponent(database)}&direction=all`

  const { data: depsData, isLoading } = useQuery<ApiResponse<DependencyEdge[]>>(
    {
      queryKey: [depsUrl],
      queryFn: () => fetcher<DependencyEdge[]>(depsUrl),
    }
  )

  const graphData = depsData?.data || []

  const { tableCount, depCount } = (() => {
    const tables = new Set<string>()
    let deps = 0
    for (const dep of graphData) {
      tables.add(dep.source_table)
      if (dep.target_table) {
        tables.add(dep.target_table)
        deps++
      }
    }
    return { tableCount: tables.size, depCount: deps }
  })()

  const metadata = (() => {
    if (!depsData?.metadata) return undefined
    return {
      ...depsData.metadata,
      api: depsUrl,
    }
  })()

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="flex-1 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="group flex h-full flex-col gap-3 p-3 sm:gap-4 sm:p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <DatabaseIcon className="size-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold sm:text-lg">
            {database}
          </h2>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {tableCount} table{tableCount !== 1 ? 's' : ''}
            {depCount > 0 &&
              ` · ${depCount} dependency relationship${depCount !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTab('query')}
          className="gap-1.5"
        >
          <SquareTerminal className="size-4" />
          Query Editor
        </Button>
        <CardToolbar
          sql={depsData?.metadata?.sql}
          metadata={metadata}
          data={graphData as unknown as Record<string, unknown>[]}
        />
      </div>

      <DependencyGraph
        dependencies={graphData}
        currentDatabase={database}
        className="flex-1 min-h-[400px]"
      />
    </div>
  )
}
