import { Download, ListFilter } from 'lucide-react'

import { downloadExpensiveCsv } from './table/csv'
import { QueryCard } from './table/query-card'
import { QueryRow } from './table/query-row'
import { type SeverityFilter, SeverityFilterBar } from './table/toolbar'
import {
  BASE_COLUMN_COUNT,
  derive,
  type ExpensiveQueryRow,
  OPTIONAL_COLUMNS,
  type OptionalColumn,
  SORT_ACCESSOR,
  type SortDir,
  type SortKey,
} from './table/types'
import { memo, useCallback, useMemo, useState } from 'react'
import { ColumnVisibilityMenu } from '@/components/query-tables/column-visibility-menu'
import {
  EmptyCards,
  EmptyTableRow,
} from '@/components/query-tables/empty-state'
import { SortableHeader } from '@/components/query-tables/sortable-header'
import { TableSearchInput } from '@/components/query-tables/table-search-input'
import { ToolbarButton } from '@/components/query-tables/toolbar-button'
import { ViewToggle } from '@/components/query-tables/view-toggle'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useLayoutView } from '@/hooks/use-layout-view'
import { formatCompactNumber } from '@/lib/format-readable'
import { cn } from '@/lib/utils'

// Re-exported so sibling modules can keep importing the row type from this
// path (`./expensive-queries-table`).
export type { ExpensiveQueryRow } from './table/types'

interface ExpensiveQueriesTableProps {
  rows: ExpensiveQueryRow[]
}

/**
 * ExpensiveQueriesTable — a dense, sortable, responsive view of the most
 * expensive ClickHouse query fingerprints over the last 24h.
 *
 * Highlights the worst offenders with rank badges (#1, #2 …) and a severity
 * heat accent. The toolbar carries search, a severity (heat) segment, a
 * "more filters" popover (minimum runs / total time), a column-visibility
 * menu and CSV export. Columns collapse progressively as the viewport
 * narrows; hidden values reappear inline under the query text. Rows expand to
 * a full secondary-metric panel + full-query dialog.
 */
export const ExpensiveQueriesTable = memo(function ExpensiveQueriesTable({
  rows,
}: ExpensiveQueriesTableProps) {
  const [search, setSearch] = useState('')
  const [severity, setSeverity] = useState<SeverityFilter>('all')
  const [minRuns, setMinRuns] = useState(0)
  const [minDurationSecs, setMinDurationSecs] = useState(0)
  const [hiddenColumns, setHiddenColumns] = useState<Set<OptionalColumn>>(
    () => new Set()
  )
  const [sortKey, setSortKey] = useState<SortKey>('duration')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [view, setView] = useLayoutView()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // The server returns rows already ordered most-expensive-first; rank is
  // assigned here so the "#1 / #2 …" badges reflect that native order and
  // survive any client-side re-sorting / filtering below.
  const derived = useMemo(() => rows.map(derive), [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = derived.filter((d) => {
      if (severity === 'critical' && d.severity !== 'critical') return false
      if (severity === 'warning' && d.severity === 'normal') return false
      if (minRuns > 0 && d.cnt < minRuns) return false
      if (minDurationSecs > 0 && d.queriesDuration < minDurationSecs)
        return false
      if (q) return d.query.toLowerCase().includes(q)
      return true
    })
    const accessor = SORT_ACCESSOR[sortKey]
    return [...filtered].sort((a, b) => {
      const cmp = accessor(a) - accessor(b)
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [derived, search, severity, minRuns, minDurationSecs, sortKey, sortDir])

  // Bar percentages are relative to the currently visible rows, so the cost
  // bars rescale to whatever the active filters (incl. the time-duration
  // filter) leave on screen.
  const { maxDuration, maxCpu, maxMemory } = useMemo(() => {
    let md = 0
    let mc = 0
    let mm = 0
    for (const d of visible) {
      if (d.queriesDuration > md) md = d.queriesDuration
      if (d.userTime > mc) mc = d.userTime
      if (d.memory > mm) mm = d.memory
    }
    return { maxDuration: md, maxCpu: mc, maxMemory: mm }
  }, [visible])

  const moreFiltersActive = minRuns > 0 || minDurationSecs > 0
  const totalColumns =
    BASE_COLUMN_COUNT + (OPTIONAL_COLUMNS.length - hiddenColumns.size)

  const toggleRow = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleSort = useCallback((key: string) => {
    const k = key as SortKey
    setSortKey((prevKey) => {
      if (prevKey === k) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prevKey
      }
      setSortDir(k === 'rank' ? 'asc' : 'desc')
      return k
    })
  }, [])

  const toggleColumn = useCallback((key: OptionalColumn) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const headerFor = (key: OptionalColumn) => !hiddenColumns.has(key)

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-2.5 sm:px-3">
        {/* Search */}
        <TableSearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search query…"
        />

        {/* Severity (heat) segment */}
        <SeverityFilterBar value={severity} onChange={setSeverity} />

        {/* More filters */}
        <Popover>
          <PopoverTrigger render={<ToolbarButton active={moreFiltersActive} />}>
            <ListFilter className="size-3.5" />
            More filters
            {moreFiltersActive && (
              <span className="ml-0.5 size-1.5 rounded-full bg-blue-500" />
            )}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 space-y-3">
            <div>
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                Minimum runs
              </p>
              <div className="flex flex-wrap gap-1">
                {[0, 10, 100, 1000].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMinRuns(n)}
                    className={cn(
                      'rounded-md border px-2 py-1 text-[11.5px] font-medium tabular-nums transition-colors',
                      minRuns === n
                        ? 'border-border bg-muted text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {n === 0 ? 'Any' : `${formatCompactNumber(n)}+`}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                Minimum total time
              </p>
              <div className="flex flex-wrap gap-1">
                {[0, 5, 30, 60].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMinDurationSecs(n)}
                    className={cn(
                      'rounded-md border px-2 py-1 text-[11.5px] font-medium tabular-nums transition-colors',
                      minDurationSecs === n
                        ? 'border-border bg-muted text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {n === 0 ? 'Any' : `${n}s+`}
                  </button>
                ))}
              </div>
            </div>
            {moreFiltersActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full text-[12px]"
                onClick={() => {
                  setMinRuns(0)
                  setMinDurationSecs(0)
                }}
              >
                Reset filters
              </Button>
            )}
          </PopoverContent>
        </Popover>

        <div className="ml-auto flex items-center gap-2">
          <span className="whitespace-nowrap text-[11.5px] tabular-nums text-muted-foreground">
            {visible.length} of {rows.length}
          </span>
          <div className="h-5 w-px bg-border" />

          {/* Table / cards view */}
          <ViewToggle active={view} onChange={setView} />

          {/* Column visibility */}
          <ColumnVisibilityMenu
            columns={OPTIONAL_COLUMNS}
            hiddenColumns={hiddenColumns}
            onToggle={toggleColumn}
          />

          {/* Export */}
          <ToolbarButton
            onClick={() => downloadExpensiveCsv(visible)}
            disabled={visible.length === 0}
          >
            <Download className="size-3.5" />
            Export
          </ToolbarButton>
        </div>
      </div>

      {view === 'cards' ? (
        /* Card list — SQL-first, the default on phones. */
        <div
          className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="expensive-queries-cards"
        >
          {visible.map((d) => (
            <QueryCard
              key={d.key}
              d={d}
              maxDuration={maxDuration}
              expanded={expanded.has(d.key)}
              onToggle={() => toggleRow(d.key)}
            />
          ))}
          {visible.length === 0 && <EmptyCards />}
        </div>
      ) : (
        /* Table — table-fixed so the Query column truncates instead of pushing
          the metric columns off-screen; `min-w` keeps columns legible on
          phones (the wrapper scrolls horizontally below it). */
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed border-collapse">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <SortableHeader
                  width="84px"
                  sortKey="rank"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                >
                  Rank
                </SortableHeader>
                <SortableHeader>Query</SortableHeader>
                <SortableHeader
                  width="140px"
                  sortKey="duration"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                >
                  Total time
                </SortableHeader>
                {headerFor('cnt') && (
                  <SortableHeader
                    align="right"
                    width="80px"
                    className="hidden sm:table-cell"
                    sortKey="cnt"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    Runs
                  </SortableHeader>
                )}
                {headerFor('cpu') && (
                  <SortableHeader
                    align="right"
                    width="96px"
                    className="hidden lg:table-cell"
                    sortKey="cpu"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    CPU time
                  </SortableHeader>
                )}
                {headerFor('memory') && (
                  <SortableHeader
                    align="right"
                    width="92px"
                    className="hidden md:table-cell"
                    sortKey="memory"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    Memory
                  </SortableHeader>
                )}
                {headerFor('readRows') && (
                  <SortableHeader
                    align="right"
                    width="92px"
                    className="hidden xl:table-cell"
                    sortKey="readRows"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    Rows read
                  </SortableHeader>
                )}
                <SortableHeader width="72px" align="right">
                  <span className="sr-only">Actions</span>
                </SortableHeader>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => (
                <QueryRow
                  key={d.key}
                  d={d}
                  maxDuration={maxDuration}
                  maxCpu={maxCpu}
                  maxMemory={maxMemory}
                  expanded={expanded.has(d.key)}
                  onToggle={() => toggleRow(d.key)}
                  hiddenColumns={hiddenColumns}
                />
              ))}
              {visible.length === 0 && <EmptyTableRow colSpan={totalColumns} />}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-border px-3 py-2 text-[11.5px] text-muted-foreground">
        Showing{' '}
        <span className="font-medium tabular-nums text-foreground">
          {visible.length}
        </span>{' '}
        of <span className="tabular-nums">{rows.length}</span> expensive{' '}
        {rows.length === 1 ? 'query' : 'queries'} · last 24h
      </div>
    </div>
  )
})
