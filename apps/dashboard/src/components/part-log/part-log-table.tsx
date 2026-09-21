import { Search } from 'lucide-react'

import type { PartLogRow } from './lib'
import type { SortKey, SortState } from './part-log-table-parts'

import { num } from './lib'
import { Row, SORT_PRESETS, SORT_VALUE, ThSort } from './part-log-table-parts'
import { useMemo, useState } from 'react'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// ───────────────────────── quick filters ─────────────────────────

interface QuickFilter {
  key: string
  label: string
  test: (r: PartLogRow) => boolean
}

const QUICK_FILTERS: QuickFilter[] = [
  { key: 'new', label: 'New parts', test: (r) => r.event_type === 'NewPart' },
  {
    key: 'merge',
    label: 'Merges',
    test: (r) => r.event_type.startsWith('Merge'),
  },
  {
    key: 'mutate',
    label: 'Mutations',
    test: (r) => r.event_type.startsWith('Mutate'),
  },
  {
    key: 'remove',
    label: 'Removals',
    test: (r) => r.event_type === 'RemovePart',
  },
  {
    key: 'move',
    label: 'Moves & downloads',
    test: (r) => r.event_type === 'MovePart' || r.event_type === 'DownloadPart',
  },
  {
    key: 'ttl',
    label: 'TTL merges',
    test: (r) => r.merge_reason.startsWith('TTL'),
  },
  {
    key: 'big',
    label: '> 100 MiB',
    test: (r) => num(r.size_in_bytes) >= 100 * 1024 * 1024,
  },
]

// ───────────────────────── main table ─────────────────────────

export function PartLogTable({
  rows,
  hostId,
}: {
  rows: PartLogRow[]
  hostId: number
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<SortState>({ key: 'time', dir: 'desc' })
  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set())

  const nowSeconds = useMemo(() => Math.floor(Date.now() / 1000), [])

  // Static filters + one chip per database seen in the loaded rows.
  const quickFilters = useMemo<QuickFilter[]>(() => {
    const dbs = [...new Set(rows.map((r) => r.database).filter(Boolean))].sort()
    return [
      ...QUICK_FILTERS,
      ...dbs.map((db) => ({
        key: `db:${db}`,
        label: `${db}.*`,
        test: (r: PartLogRow) => r.database === db,
      })),
    ]
  }, [rows])

  const toggleRow = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleFilter = (k: string) =>
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'time' ? 'desc' : 'desc' }
    )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filters = quickFilters.filter((f) => activeFilters.has(f.key))
    const out = rows.filter((r) => {
      if (q) {
        const hay =
          `${r.part_name} ${r.table} ${r.event_type} ${r.partition_id}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      for (const f of filters) if (!f.test(r)) return false
      return true
    })
    const value = SORT_VALUE[sort.key]
    out.sort((a, b) => {
      const av = value(a)
      const bv = value(b)
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv))
      return sort.dir === 'desc' ? -cmp : cmp
    })
    return out
  }, [rows, search, activeFilters, sort, quickFilters])

  const maxSize = useMemo(
    () => Math.max(...rows.map((r) => num(r.size_in_bytes)), 1),
    [rows]
  )

  const rowKey = (r: PartLogRow, i: number) =>
    `${r.event_time}-${r.part_name}-${r.event_type}-${i}`

  return (
    <div className="flex flex-col gap-3">
      {/* search + quick filters */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-2.5 sm:px-3">
          <div className="relative flex min-w-[200px] flex-1 items-center">
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search part name, table, event type, partition…"
              className="h-9 pl-8 text-[13px]"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-2.5 py-2.5 sm:px-3">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Quick filters
          </span>
          {quickFilters.map((f) => {
            const on = activeFilters.has(f.key)
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => toggleFilter(f.key)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  on
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {f.label}
              </button>
            )
          })}
          {activeFilters.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveFilters(new Set())}
              className="ml-auto rounded-sm text-[11.5px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[12px]">
          <span className="font-semibold">Events</span>
          <span className="tabular-nums text-muted-foreground">
            · {filtered.length} of {rows.length} shown
          </span>
          <div className="flex-1" />
          <div className="hidden items-center gap-0.5 rounded-md bg-muted p-0.5 sm:flex">
            {SORT_PRESETS.map((p) => {
              const active = sort.key === p.key && sort.dir === p.dir
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setSort({ key: p.key, dir: p.dir })}
                  className={cn(
                    'h-7 rounded px-2.5 text-[11.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    active
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table
            className="w-full border-collapse"
            style={{ tableLayout: 'fixed' }}
          >
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <ThSort
                  sortKey="time"
                  sort={sort}
                  onSort={onSort}
                  style={{ width: '132px' }}
                >
                  Event time
                </ThSort>
                <ThSort
                  sortKey="event_type"
                  sort={sort}
                  onSort={onSort}
                  style={{ width: '150px' }}
                >
                  Event type
                </ThSort>
                <ThSort
                  sortKey="table"
                  sort={sort}
                  onSort={onSort}
                  style={{ width: '220px' }}
                >
                  Table
                </ThSort>
                <ThSort
                  sort={sort}
                  onSort={onSort}
                  className="hidden lg:table-cell"
                >
                  Part name
                </ThSort>
                <ThSort
                  sort={sort}
                  onSort={onSort}
                  className="hidden xl:table-cell"
                  style={{ width: '96px' }}
                >
                  Partition
                </ThSort>
                <ThSort
                  sort={sort}
                  onSort={onSort}
                  className="hidden md:table-cell"
                  style={{ width: '150px' }}
                >
                  Merge reason
                </ThSort>
                <ThSort
                  align="right"
                  sortKey="size"
                  sort={sort}
                  onSort={onSort}
                  style={{ width: '140px' }}
                >
                  Size
                </ThSort>
                <ThSort
                  sort={sort}
                  onSort={onSort}
                  className="text-right"
                  style={{ width: '64px' }}
                />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const id = rowKey(row, i)
                return (
                  <Row
                    key={id}
                    row={row}
                    maxSize={maxSize}
                    expanded={expanded.has(id)}
                    onToggle={() => toggleRow(id)}
                    hostId={hostId}
                    nowSeconds={nowSeconds}
                  />
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8">
                    <EmptyState
                      variant="filtered-empty"
                      compact
                      action={{
                        label: 'Clear filters',
                        onClick: () => {
                          setActiveFilters(new Set())
                          setSearch('')
                        },
                      }}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11.5px] text-muted-foreground">
          <div>
            Showing{' '}
            <span className="font-medium tabular-nums text-foreground">
              {filtered.length}
            </span>{' '}
            of <span className="tabular-nums">{rows.length}</span> loaded events
          </div>
        </div>
      </div>
    </div>
  )
}
