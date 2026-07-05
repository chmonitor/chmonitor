import {
  ChevronDown,
  Download,
  ListFilter,
  User as UserIcon,
} from 'lucide-react'

import { downloadRunningCsv } from './table/csv'
import { QueryCard } from './table/query-card'
import { QueryRow } from './table/query-row'
import { KindFilter } from './table/toolbar'
import {
  BASE_COLUMN_COUNT,
  derive,
  OPTIONAL_COLUMNS,
  type OptionalColumn,
  type RunningQueryRow,
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useLayoutView } from '@/hooks/use-layout-view'
import { cn } from '@/lib/utils'

// Re-exported so sibling modules can keep importing the row type from this
// path (`./running-queries-table`).
export type { RunningQueryRow } from './table/types'

interface RunningQueriesTableProps {
  /** Live `system.processes` rows. Drives the toolbar/footer counts and CSV. */
  rows: RunningQueryRow[]
  /**
   * Retained "Done" rows — queries the user had expanded that have since left
   * `system.processes`. Rendered pinned above the live rows in a finished
   * state; excluded from the "active" counts and export.
   */
  doneRows: RunningQueryRow[]
  /**
   * Expanded row keys. Owned by the parent view so an expanded row survives as
   * a Done row even when the live list (and this table) would otherwise unmount.
   */
  expanded: Set<string>
  /** Toggle a row's expansion by its stable key. */
  onToggle: (key: string) => void
  /** Dismiss a retained Done row by query_id. */
  onDismiss: (id: string) => void
}

/**
 * RunningQueriesTable — a dense, sortable, responsive table of in-flight
 * ClickHouse queries.
 *
 * The toolbar carries search, a query-kind segment, a user filter, a
 * "more filters" popover (interface + long-running), a column-visibility menu
 * and CSV export. Columns also collapse progressively as the viewport narrows;
 * hidden values reappear inline under the query text. Rows expand to a full
 * execution-details panel.
 */
export const RunningQueriesTable = memo(function RunningQueriesTable({
  rows,
  doneRows,
  expanded,
  onToggle,
  onDismiss,
}: RunningQueriesTableProps) {
  const [search, setSearch] = useState('')
  const [filterKind, setFilterKind] = useState('all')
  const [filterUser, setFilterUser] = useState('all')
  const [filterInterface, setFilterInterface] = useState('all')
  const [longRunningOnly, setLongRunningOnly] = useState(false)
  const [hiddenColumns, setHiddenColumns] = useState<Set<OptionalColumn>>(
    () => new Set()
  )
  const [sortKey, setSortKey] = useState<SortKey>('duration')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  // Card view leads on phones (the wide metric table is unreadable in a scroll
  // box), table on desktop — with a toggle so either is reachable anywhere.
  const [view, setView] = useLayoutView()

  // Expansion is owned by the parent view (keyed by the stable `query_id`), so
  // an expanded row can be retained as a "Done" row when it finishes rather
  // than vanishing with the live list. A row stays open across refreshes,
  // re-sorts and filters as long as that identifier is stable.

  const derived = useMemo(() => rows.map(derive), [rows])
  // Retained Done rows, pinned above the live rows and exempt from the live
  // search / filter / sort so they stay put until dismissed.
  const derivedDone = useMemo(() => doneRows.map(derive), [doneRows])

  // Filter options come from the values actually present in the data.
  const kindOptions = useMemo(() => {
    const kinds = new Set<string>()
    for (const d of derived) kinds.add(d.kind)
    return ['all', ...Array.from(kinds).sort()]
  }, [derived])

  const userOptions = useMemo(() => {
    const users = new Set<string>()
    for (const d of derived) if (d.user) users.add(d.user)
    return Array.from(users).sort()
  }, [derived])

  const interfaceOptions = useMemo(() => {
    const ifaces = new Set<string>()
    for (const d of derived) if (d.iface) ifaces.add(d.iface)
    return Array.from(ifaces).sort()
  }, [derived])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = derived.filter((d) => {
      if (filterKind !== 'all' && d.kind !== filterKind) return false
      if (filterUser !== 'all' && d.user !== filterUser) return false
      if (filterInterface !== 'all' && d.iface !== filterInterface) return false
      if (longRunningOnly && d.elapsed <= 30) return false
      if (q) {
        return (
          d.id.toLowerCase().includes(q) ||
          d.query.toLowerCase().includes(q) ||
          d.user.toLowerCase().includes(q)
        )
      }
      return true
    })
    const accessor = SORT_ACCESSOR[sortKey]
    return [...filtered].sort((a, b) => {
      const cmp = accessor(a) - accessor(b)
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [
    derived,
    search,
    filterKind,
    filterUser,
    filterInterface,
    longRunningOnly,
    sortKey,
    sortDir,
  ])

  const moreFiltersActive = filterInterface !== 'all' || longRunningOnly
  const totalColumns =
    BASE_COLUMN_COUNT + (OPTIONAL_COLUMNS.length - hiddenColumns.size)

  const handleSort = useCallback((key: string) => {
    const k = key as SortKey
    setSortKey((prevKey) => {
      if (prevKey === k) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prevKey
      }
      setSortDir('desc')
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
          placeholder="Search query, id, user…"
        />

        {/* Query-kind segment */}
        <KindFilter
          options={kindOptions}
          value={filterKind}
          onChange={setFilterKind}
        />

        {/* User filter */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<ToolbarButton active={filterUser !== 'all'} />}
          >
            <UserIcon className="size-3.5" />
            {filterUser === 'all' ? 'All users' : filterUser}
            <ChevronDown className="size-3 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Filter by user</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={filterUser}
              onValueChange={setFilterUser}
            >
              <DropdownMenuRadioItem value="all">
                All users
              </DropdownMenuRadioItem>
              {userOptions.map((user) => (
                <DropdownMenuRadioItem key={user} value={user}>
                  {user}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* More filters */}
        <Popover>
          <PopoverTrigger render={<ToolbarButton active={moreFiltersActive} />}>
            <ListFilter className="size-3.5" />
            More filters
            {moreFiltersActive && (
              <span className="ml-0.5 size-1.5 rounded-full bg-blue-500" />
            )}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-60 space-y-3">
            <div>
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                Interface
              </p>
              <div className="flex flex-wrap gap-1">
                {['all', ...interfaceOptions].map((iface) => (
                  <button
                    key={iface}
                    type="button"
                    onClick={() => setFilterInterface(iface)}
                    className={cn(
                      'rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors',
                      filterInterface === iface
                        ? 'border-border bg-muted text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {iface === 'all' ? 'All' : iface}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
              <Checkbox
                checked={longRunningOnly}
                onCheckedChange={(c) => setLongRunningOnly(c === true)}
              />
              Long-running only{' '}
              <span className="text-muted-foreground">(&gt; 30s)</span>
            </label>
            {moreFiltersActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full text-[12px]"
                onClick={() => {
                  setFilterInterface('all')
                  setLongRunningOnly(false)
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
            onClick={() => downloadRunningCsv(visible)}
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
          data-testid="running-queries-cards"
        >
          {derivedDone.map((d) => (
            <QueryCard
              key={d.key}
              d={d}
              done
              expanded={expanded.has(d.key)}
              onToggle={() => onToggle(d.key)}
              onDismiss={() => onDismiss(d.id)}
            />
          ))}
          {visible.map((d) => (
            <QueryCard
              key={d.key}
              d={d}
              expanded={expanded.has(d.key)}
              onToggle={() => onToggle(d.key)}
            />
          ))}
          {visible.length === 0 && derivedDone.length === 0 && <EmptyCards />}
        </div>
      ) : (
        /* Table — table-fixed so the Query column truncates instead of pushing
          the metric columns off-screen. `min-w` keeps the columns legible on
          phones: below it the wrapper scrolls horizontally rather than letting
          table-fixed crush the Query column to a few pixels. */
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed border-collapse">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <SortableHeader width="108px">Type</SortableHeader>
                <SortableHeader>Query</SortableHeader>
                <SortableHeader
                  width="140px"
                  sortKey="progress"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                >
                  Progress
                </SortableHeader>
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
                {headerFor('dataRead') && (
                  <SortableHeader
                    align="right"
                    width="96px"
                    className="hidden xl:table-cell"
                    sortKey="dataRead"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    Data
                  </SortableHeader>
                )}
                {headerFor('cpu') && (
                  <SortableHeader
                    align="right"
                    width="104px"
                    className="hidden lg:table-cell"
                    sortKey="cpu"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    CPU
                  </SortableHeader>
                )}
                {headerFor('threads') && (
                  <SortableHeader
                    align="right"
                    width="72px"
                    className="hidden 2xl:table-cell"
                    sortKey="threads"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    Threads
                  </SortableHeader>
                )}
                {headerFor('duration') && (
                  <SortableHeader
                    align="right"
                    width="86px"
                    className="hidden sm:table-cell"
                    sortKey="duration"
                    activeKey={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    Duration
                  </SortableHeader>
                )}
                <SortableHeader width="84px" align="right">
                  <span className="sr-only">Actions</span>
                </SortableHeader>
              </tr>
            </thead>
            <tbody>
              {/* Retained Done rows, pinned above the live rows. */}
              {derivedDone.map((d) => (
                <QueryRow
                  key={d.key}
                  d={d}
                  done
                  expanded={expanded.has(d.key)}
                  onToggle={() => onToggle(d.key)}
                  onDismiss={() => onDismiss(d.id)}
                  hiddenColumns={hiddenColumns}
                />
              ))}
              {visible.map((d) => (
                // Keyed by stable row key so each row keeps identity and
                // component state through refreshes, sorts and filters.
                <QueryRow
                  key={d.key}
                  d={d}
                  expanded={expanded.has(d.key)}
                  onToggle={() => onToggle(d.key)}
                  hiddenColumns={hiddenColumns}
                />
              ))}
              {visible.length === 0 && derivedDone.length === 0 && (
                <EmptyTableRow colSpan={totalColumns} />
              )}
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
        of <span className="tabular-nums">{rows.length}</span> active{' '}
        {rows.length === 1 ? 'query' : 'queries'}
      </div>
    </div>
  )
})
