import { AlertCircle } from 'lucide-react'

import type {
  ChildQueryRow,
  QueryDetailRow,
} from '@/components/query-detail/query-detail-types'

import { useMemo } from 'react'
import { toStr } from '@/components/query-detail/query-detail-badges'
import {
  CollapsibleSection,
  SqlBlock,
} from '@/components/query-detail/query-detail-parts'
import {
  QueryDetailChildren,
  QueryDetailHeader,
  QueryDetailInsights,
  QueryDetailMetrics,
} from '@/components/query-detail/query-detail-sections'
import { QueryStagesChart } from '@/components/query-detail/query-stages-chart'
import { TableSkeleton } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { buildExplorerQueryUrl } from '@/lib/explorer-url'
import { deriveQueryInsights } from '@/lib/query/query-insights'
import { useTableData } from '@/lib/query/use-table-data'
import { useHostId } from '@/lib/swr/use-host'

interface QueryDetailViewProps {
  queryId: string
}

/**
 * QueryDetailView — redesigned query detail page using the CHM design system.
 *
 * Sections (see `query-detail-sections.tsx` for the presentational pieces):
 *  1. Header card — query_id, status/type badge, user, times, host
 *  2. Metrics strip — KpiCards for duration, read rows, read bytes, memory
 *  3. SQL block — inline, no modal; beautify off by default
 *  4. Insights — client-side red flags
 *  5. ProfileEvents + Settings — collapsible sections
 *  6. Child queries — distributed/parallel leaves
 *
 * Works for both running queries (from system.processes via the action link)
 * and finished queries (from system.query_log). If no row is found, shows
 * a "Query not found" empty state.
 */
export const QueryDetailView = function QueryDetailView({
  queryId,
}: QueryDetailViewProps) {
  const hostId = useHostId()

  const { data, isLoading, error, refresh } = useTableData<QueryDetailRow>(
    'query-detail',
    hostId,
    { query_id: queryId }
  )

  // Child queries spawned by this one (distributed/parallel leaves). Fetched
  // unconditionally to keep hook order stable; rendered only when non-empty.
  const { data: childrenData } = useTableData<ChildQueryRow>(
    'query-children',
    hostId,
    { query_id: queryId }
  )

  const row = data?.[0]

  // Cheap client-side red-flags from the loaded row (exception, slow, memory,
  // full-scan, low selectivity). Memoized on the row reference.
  const insights = useMemo(() => (row ? deriveQueryInsights(row) : []), [row])

  // Hooks must be called unconditionally — compute from `row` (may be undefined)
  // before any early returns.

  // ProfileEvents — filter out zero values for a cleaner view
  const profileEntries = (() => {
    const map = row?.ProfileEvents
    if (!map || typeof map !== 'object' || Array.isArray(map)) return []
    return Object.entries(map)
      .filter(([, v]) => {
        const n = Number(v)
        return Number.isFinite(n) ? n !== 0 : Boolean(v)
      })
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => [k, String(v)] as [string, string])
  })()

  // Settings — show all non-empty entries
  const settingsEntries = (() => {
    const map = row?.Settings
    if (!map || typeof map !== 'object' || Array.isArray(map)) return []
    return Object.entries(map)
      .filter(([, v]) => v != null && v !== '')
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => [k, String(v)] as [string, string])
  })()

  // ── Loading ──
  if (isLoading) {
    return <TableSkeleton />
  }

  // ── API error ──
  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <AlertCircle className="size-8 text-destructive/60" />
        <p className="text-[13px] text-muted-foreground">
          {error instanceof Error ? error.message : 'Failed to load query'}
        </p>
        <Button variant="outline" size="sm" onClick={() => refresh()}>
          Retry
        </Button>
      </div>
    )
  }

  // ── Not found ──
  if (!row) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-[13px] text-muted-foreground">
          Query not found. It may have been purged from{' '}
          <code className="font-mono text-[12px]">system.query_log</code>.
        </p>
      </div>
    )
  }

  const queryText = toStr(row.query)
  const explorerUrl = buildExplorerQueryUrl(queryText, hostId)

  return (
    <div className="flex flex-col gap-4">
      <QueryDetailHeader
        row={row}
        queryId={queryId}
        hostId={hostId}
        explorerUrl={explorerUrl}
      />

      <QueryDetailMetrics row={row} />

      {/* SQL block — inline, no modal; beautify off by default */}
      {queryText && <SqlBlock query={queryText} />}

      {/* Query stages — per-processor duration breakdown. Renders nothing
          when the optional processors_profile_log table is empty. */}
      <QueryStagesChart queryId={queryId} />

      <QueryDetailInsights insights={insights} />

      {profileEntries.length > 0 && (
        <CollapsibleSection title="Profile Events" entries={profileEntries} />
      )}
      {settingsEntries.length > 0 && (
        <CollapsibleSection title="Query Settings" entries={settingsEntries} />
      )}

      <QueryDetailChildren childrenData={childrenData ?? []} hostId={hostId} />
    </div>
  )
}
