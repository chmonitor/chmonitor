import { LayoutDashboardIcon, MinimizeIcon, RefreshCw } from 'lucide-react'

import type { CompletedQueryRow } from '@/components/running-queries/completed-queries-table'
import type { RunningQueryRow } from '@/components/running-queries/running-queries-table'
import type { CardError } from '@/lib/card-error-utils'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/layout'
import { CollapsedChartsRow } from '@/components/layout/query-page/collapsed-charts-row'
import { HeaderButton } from '@/components/query-tables/header-button'
import { QueryPageSkeleton } from '@/components/query-tables/query-page-skeleton'
import { CompletedQueriesTable } from '@/components/running-queries/completed-queries-table'
import { RunningQueriesCharts } from '@/components/running-queries/running-queries-charts'
import { RunningQueriesTable } from '@/components/running-queries/running-queries-table'
import { reconcileDoneRows } from '@/components/running-queries/table/done-retention'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  detectCardErrorVariant,
  getCardErrorDescription,
  getCardErrorTitle,
  toEmptyStateVariant,
} from '@/lib/card-error-utils'
import {
  parseFiltersFromParams,
  serializeActiveFilters,
} from '@/lib/filters/url-state'
import { useSearchParams } from '@/lib/next-compat'
import { useTableData } from '@/lib/query/use-table-data'
import { runningQueriesConfig } from '@/lib/query-config/queries/running-queries'
import { useHostId } from '@/lib/swr/use-host'
import { track } from '@/lib/telemetry'
import { cn } from '@/lib/utils'

/**
 * Auto-refresh cadence for the running-queries list (ms).
 *
 * Defaults to 5s so the table reads as genuinely "live"; `system.processes`
 * is an in-memory table, so frequent polling is cheap.
 * Override with `VITE_RUNNING_QUERIES_REFRESH_MS`.
 */
const REFRESH_INTERVAL = (() => {
  const envValue = import.meta.env.VITE_RUNNING_QUERIES_REFRESH_MS
  const parsed = envValue ? Number.parseInt(envValue, 10) : NaN
  return !Number.isNaN(parsed) && parsed > 0 ? parsed : 5_000
})()

const REFRESH_SECONDS = Math.round(REFRESH_INTERVAL / 1000)

/**
 * Filter params for the recently-completed table: finished queries from the
 * last hour, newest first (the underlying `history-queries` config already
 * orders by `event_time DESC`). The window resets naturally on every reload,
 * keeping the list to a recent slice rather than the full history.
 */
const COMPLETED_FILTER_PARAMS = {
  type: 'eq:QueryFinish',
  event_time: 'withinHours:1',
} as const

/**
 * Build a synthetic completed-query row from the last running snapshot of a
 * query that just left the live list. Used to show the query in the completed
 * table immediately, before its authoritative `system.query_log` row arrives.
 */
function runningToCompleted(row: RunningQueryRow): CompletedQueryRow {
  const now = new Date()
  return {
    query_id: String(row.query_id ?? ''),
    query: String(row.query ?? ''),
    query_kind: row.query_kind,
    type: 'QueryFinish',
    user: row.user,
    // Local clock — only the HH:MM:SS portion is rendered in the table.
    event_time: now.toTimeString().slice(0, 8),
    query_duration: Number(row.elapsed ?? 0),
    read_rows: Number(row.read_rows ?? 0),
    readable_read_rows: row.readable_read_rows,
    written_rows: Number(row.written_rows ?? 0),
    memory_usage: Number(row.memory_usage ?? 0),
    readable_memory_usage: row.readable_memory_usage,
    client_name: row.client_name,
  }
}

// LoadingState is replaced by QueryPageSkeleton from @/components/query-tables/query-page-skeleton
// HeaderButton is imported from @/components/query-tables/header-button

/**
 * RunningQueriesView — the Running Queries page.
 *
 * A self-contained layout: header (title, live count, charts toggle, refresh,
 * live toggle) → collapsible four-card chart strip → the sortable
 * {@link RunningQueriesTable}. Data comes from `system.processes`; auto-refresh
 * runs on {@link REFRESH_INTERVAL} while "Live" is on and pauses when off.
 */
export const RunningQueriesView = function RunningQueriesView() {
  const hostId = useHostId()
  const searchParams = useSearchParams()
  const [chartsOpen, setChartsOpen] = useState(true)
  const [live, setLive] = useState(true)

  // Fire-and-forget product telemetry — no-op unless enabled.
  useEffect(() => {
    track('queries_viewed')
  }, [])

  // Pipe URL-driven filter params into the SWR key so the schema-driven
  // header filters and bar (rendered by the underlying DataTable) actually
  // shape the data fetched from /api/v1/tables/running-queries.
  const filterParams = (() => {
    const schema = runningQueriesConfig.filterSchema
    if (!schema) return undefined
    const serialized = serializeActiveFilters(
      parseFiltersFromParams(schema, searchParams)
    )
    // Map the `q` text-search param to a server-side `contains` on the query column.
    const q = searchParams.get('q')
    if (q?.trim()) {
      serialized.query = `contains:${q.trim()}`
    }
    return Object.keys(serialized).length > 0 ? serialized : undefined
  })()

  const { data, error, isLoading, isValidating, refresh } =
    useTableData<RunningQueryRow>(
      'running-queries',
      hostId,
      filterParams,
      live ? REFRESH_INTERVAL : 0
    )

  const rows = data ?? []

  // Recently-completed queries (system.query_log, QueryFinish, last hour).
  // Polled on the same cadence as the running list while Live is on so a
  // finished query lands in this table shortly after it leaves the one above.
  const { data: completedData } = useTableData<CompletedQueryRow>(
    'history-queries',
    hostId,
    COMPLETED_FILTER_PARAMS,
    live ? REFRESH_INTERVAL : 0
  )
  const completedRows = completedData ?? []

  // Diff successive running polls: a query_id present last time but absent now
  // has "just finished". Those ids are highlighted in the completed table, and
  // the last-seen running row is kept so the query can be shown there even
  // before its `system.query_log` row materializes (the live handoff). Each
  // pending row clears once the real query_log row arrives.
  const prevRunningRef = useRef<Map<string, RunningQueryRow>>(new Map())
  const [justFinishedIds, setJustFinishedIds] = useState<Set<string>>(
    () => new Set()
  )
  const [pendingFinished, setPendingFinished] = useState<CompletedQueryRow[]>(
    []
  )

  // Row expansion is owned here rather than inside the table: the table unmounts
  // when the live list empties, so a retained "Done" row must outlive it. Keyed
  // by the stable `query_id` (the table's row key for identified rows).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Finished queries the user had expanded, retained as Done rows (keyed by
  // query_id) so an in-flight inspection is not lost when the query leaves
  // `system.processes`. Cleared on dismiss or unmount (navigate away).
  const [doneRows, setDoneRows] = useState<Map<string, RunningQueryRow>>(
    () => new Map()
  )
  const dismissDone = useCallback((id: string) => {
    setDoneRows((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
    setExpanded((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  useEffect(() => {
    // Only diff once the running list has loaded; an undefined `data` means the
    // first fetch is still in flight, which must not count every id as gone.
    if (!data) return
    const current = new Map<string, RunningQueryRow>()
    for (const r of data) {
      const id = String(r.query_id ?? '')
      if (id) current.set(id, r)
    }
    const finishedRows: RunningQueryRow[] = []
    for (const [id, row] of prevRunningRef.current) {
      if (!current.has(id)) finishedRows.push(row)
    }
    prevRunningRef.current = current
    // Retain finished rows the user had expanded (the keep-Done behaviour).
    // reconcileDoneRows returns the previous map unchanged when nothing was
    // added or removed, so this setState bails out of a needless re-render.
    const currentIds = new Set(current.keys())
    setDoneRows((prev) =>
      reconcileDoneRows(prev, finishedRows, currentIds, expandedRef.current)
    )
    if (finishedRows.length > 0) {
      const finishedIds = finishedRows.map((r) => String(r.query_id))
      setJustFinishedIds((prev) => {
        const next = new Set(prev)
        for (const id of finishedIds) next.add(id)
        return next
      })
      // Synthesize completed rows from the last running snapshot so the query
      // appears immediately; deduped/replaced once query_log catches up.
      setPendingFinished((prev) => {
        const seen = new Set(prev.map((r) => r.query_id))
        const additions = finishedRows
          .filter((r) => !seen.has(String(r.query_id)))
          .map(runningToCompleted)
        return additions.length > 0 ? [...additions, ...prev] : prev
      })
    }
    // Runs once per running-list poll (each new `data` reference).
  }, [data])

  // Merge synthetic pending rows with the real query_log rows. A pending row is
  // dropped as soon as the same query_id surfaces in `completedRows`, so the
  // authoritative query_log row (with final duration/memory) takes over.
  const completedQueryIds = new Set(
    completedRows.map((r) => String(r.query_id ?? '')).filter(Boolean)
  )
  const livePending = pendingFinished.filter(
    (r) => !completedQueryIds.has(String(r.query_id))
  )
  const mergedCompleted =
    livePending.length > 0 ? [...livePending, ...completedRows] : completedRows

  // Retained Done rows, newest-first (most recently finished at the top).
  const doneRowsArr = useMemo(
    () => Array.from(doneRows.values()).reverse(),
    [doneRows]
  )

  const errVariant = error
    ? detectCardErrorVariant(error as CardError)
    : undefined
  const emptyStateVariant = errVariant
    ? toEmptyStateVariant(errVariant)
    : undefined

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        {/* Header */}
        <PageHeader
          title={
            <div className="flex items-center gap-2">
              Running Queries
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium tabular-nums text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {rows.length} active
              </span>
            </div>
          }
          description={
            live
              ? `Queries currently executing on the cluster · auto-refreshes every ${REFRESH_SECONDS}s`
              : 'Queries currently executing on the cluster · auto-refresh paused'
          }
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              <HeaderButton onClick={() => setChartsOpen((v) => !v)}>
                {chartsOpen ? (
                  <MinimizeIcon className="size-3.5" />
                ) : (
                  <LayoutDashboardIcon className="size-3.5" />
                )}
                {chartsOpen ? 'Collapse charts' : 'Expand charts'}
              </HeaderButton>
              <HeaderButton onClick={() => refresh()} disabled={isValidating}>
                <RefreshCw
                  className={cn('size-3.5', isValidating && 'animate-spin')}
                />
                Refresh
              </HeaderButton>
              <HeaderButton onClick={() => setLive((v) => !v)}>
                <span className="relative inline-flex size-2">
                  {live && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-70" />
                  )}
                  <span
                    className={cn(
                      'relative inline-flex size-2 rounded-full',
                      live ? 'bg-rose-500' : 'bg-muted-foreground/40'
                    )}
                  />
                </span>
                {live ? 'Live' : 'Paused'}
              </HeaderButton>
            </div>
          }
        />

        {/* Body */}
        {isLoading && !data ? (
          <QueryPageSkeleton />
        ) : error && !data ? (
          <Card className="rounded-xl">
            <CardContent className="p-4">
              <EmptyState
                variant={emptyStateVariant}
                title={getCardErrorTitle(errVariant!, 'Running Queries')}
                description={getCardErrorDescription(
                  error as CardError,
                  errVariant!
                )}
                compact
                action={{
                  label: 'Retry',
                  onClick: refresh,
                  icon: <RefreshCw className="mr-1.5 size-3.5" />,
                }}
              />
            </CardContent>
          </Card>
        ) : (
          <>
            {chartsOpen ? (
              <>
                {/* Trend charts on this page use a fixed 14-day window for historical
                    context and are not affected by the global time-range picker. */}
                <p className="text-[11px] text-muted-foreground">
                  Trend charts use a fixed 14-day window · not affected by the
                  global time-range picker
                </p>
                <RunningQueriesCharts rows={rows} />
              </>
            ) : (
              <CollapsedChartsRow
                labels={[
                  'Running over time',
                  'Query memory',
                  'Queries by user',
                  'Summary',
                ]}
                onExpand={() => setChartsOpen(true)}
              />
            )}
            {/* The table renders its own toolbar (search, filters, column
                visibility, export) regardless of row count — an empty
                live/done set only swaps the body region for an inline empty
                message, so those controls stay reachable while waiting for
                queries to appear. */}
            <RunningQueriesTable
              rows={rows}
              doneRows={doneRowsArr}
              expanded={expanded}
              onToggle={toggleExpanded}
              onDismiss={dismissDone}
            />
            <CompletedQueriesTable
              rows={mergedCompleted}
              justFinishedIds={justFinishedIds}
              refreshLabel={live ? `${REFRESH_SECONDS}s` : undefined}
            />
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
