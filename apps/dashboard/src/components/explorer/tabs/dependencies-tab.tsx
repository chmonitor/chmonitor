import { useQuery } from '@tanstack/react-query'

import type { ApiResponseMetadata } from '@/lib/api/types'

import {
  type DependencyEdge,
  DependencyGraph,
  type DependencyType,
} from '../dependency-graph/dependency-graph'
import { useExplorerState } from '../hooks/use-explorer-state'
import { CardToolbar } from '@/components/cards/card-toolbar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  detectCardErrorVariant,
  getCardErrorDescription,
} from '@/lib/card-error-utils'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'

interface ApiResponse<T> {
  data: T
  metadata?: ApiResponseMetadata
}

const fetcher = async <T,>(url: string): Promise<ApiResponse<T>> => {
  const res = await apiFetch(url)
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`)
  }
  return res.json()
}

/**
 * Get a human-readable label for dependency type
 */
function getDependencyTypeLabel(type?: DependencyType): string {
  switch (type) {
    case 'dependency':
      return 'MV/View'
    case 'dictGet':
      return 'dictGet()'
    case 'joinGet':
      return 'joinGet()'
    case 'mv_target':
      return 'MV writes TO'
    case 'dict_source':
      return 'Dict source'
    case 'external':
      return 'External'
    default:
      return 'Table'
  }
}

export function DependenciesTab() {
  const hostId = useHostId()
  const { database, table } = useExplorerState()

  // Use unified API for both table and database level
  const apiUrl = (() => {
    if (!database) return null
    if (table) {
      // Table-level: get all dependencies for this specific table
      return `/api/v1/explorer/dependencies?hostId=${hostId}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}&direction=table`
    }
    // Database-level: get all dependencies in the database
    return `/api/v1/explorer/dependencies?hostId=${hostId}&database=${encodeURIComponent(database)}&direction=all`
  })()

  const {
    data: response,
    error,
    isLoading,
  } = useQuery<ApiResponse<DependencyEdge[]>>({
    queryKey: [apiUrl],
    queryFn: () => fetcher<DependencyEdge[]>(apiUrl!),
    enabled: Boolean(apiUrl),
  })

  const dependencies = response?.data || []

  // Count actual dependency edges (not standalone nodes)
  const { depCount, hasRealDeps } = (() => {
    let count = 0
    for (const dep of dependencies) {
      if (dep.target_table && dep.dependency_type) {
        count++
      }
    }
    return { depCount: count, hasRealDeps: count > 0 }
  })()

  // Build summary of dependency types
  const depTypeSummary = (() => {
    const types = new Map<DependencyType, number>()
    for (const dep of dependencies) {
      if (dep.dependency_type && dep.target_table) {
        const current = types.get(dep.dependency_type) || 0
        types.set(dep.dependency_type, current + 1)
      }
    }
    return Array.from(types.entries())
      .map(([type, count]) => `${count} ${getDependencyTypeLabel(type)}`)
      .join(', ')
  })()

  if (!database) {
    return null
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-[600px] w-full rounded-lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-lg border bg-muted/10 text-sm text-destructive">
        Failed to load dependencies:{' '}
        {getCardErrorDescription(error, detectCardErrorVariant(error))}
      </div>
    )
  }

  const title = table
    ? `Dependencies: ${table}`
    : `Database Dependencies: ${database}`

  const subtitle = hasRealDeps
    ? `${depCount} relationship${depCount !== 1 ? 's' : ''} (${depTypeSummary})`
    : table
      ? 'No dependencies found for this table'
      : 'No dependencies found in this database'

  return (
    <div className="group flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <CardToolbar
          sql={response?.metadata?.sql}
          metadata={
            response?.metadata
              ? { ...response.metadata, api: apiUrl || '' }
              : undefined
          }
          data={dependencies as unknown as Record<string, unknown>[]}
        />
      </div>
      <DependencyGraph
        dependencies={dependencies}
        currentTable={table || undefined}
        currentDatabase={database}
        className="h-[600px]"
      />
    </div>
  )
}
