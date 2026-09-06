'use client'

import { GitForkIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import type { DependencyEdge } from '@/components/explorer/dependency-graph/dependency-graph'

import { type ApiResponse, dependencyTypeLabel, fetchJson } from './helpers'
import { TableSkeleton } from '@/components/skeletons'
import { AppLink as Link } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import { useHostId } from '@/lib/swr'
import { buildUrl } from '@/lib/url/url-builder'

export function TableRelations({
  database,
  table,
}: {
  database: string
  table: string
}) {
  const hostId = useHostId()
  const apiUrl = `/api/v1/explorer/dependencies?hostId=${hostId}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}&direction=table`
  const { data, error, isLoading } = useQuery<ApiResponse<DependencyEdge[]>>({
    queryKey: [apiUrl],
    queryFn: () => fetchJson<ApiResponse<DependencyEdge[]>>(apiUrl),
  })
  const edges = (data?.data ?? []).filter(
    (edge) => edge.target_table && edge.dependency_type
  )

  return (
    <section className="space-y-2" data-testid="advisor-table-relations">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <GitForkIcon
            className="size-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <h2 className="text-sm font-medium text-foreground">Relations</h2>
        </div>
        <Link
          href={buildUrl('/explorer', {
            host: hostId,
            database,
            table,
            tab: 'dependencies',
          })}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open in Explorer
        </Link>
      </div>
      {isLoading ? <TableSkeleton rows={2} /> : null}
      {error ? (
        <p className="text-xs text-muted-foreground">
          Could not load relations.
        </p>
      ) : null}
      {!isLoading && !error && edges.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No materialized views or related objects found for this table.
        </p>
      ) : null}
      {edges.length > 0 ? (
        <ul className="space-y-1.5">
          {edges.map((edge) => {
            const targetDb = edge.target_database || database
            const targetTable = edge.target_table as string
            return (
              <li
                key={`${edge.source_database}.${edge.source_table}->${targetDb}.${targetTable}:${edge.dependency_type}`}
                className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-[13px]"
              >
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">
                    {edge.source_database}.{edge.source_table}
                  </span>
                  <span className="px-1.5 text-muted-foreground">→</span>
                  <span className="font-medium">
                    {targetDb}.{targetTable}
                  </span>
                </span>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {dependencyTypeLabel(edge.dependency_type)}
                </Badge>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
