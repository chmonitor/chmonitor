import {
  ChevronRight,
  Clock,
  Database,
  ExternalLink,
  MemoryStick,
  Rows3,
  ScanSearch,
  User as UserIcon,
} from 'lucide-react'

import { memo, useMemo, useState } from 'react'
import { CodeDialogFormat } from '@/components/data-table/cells/code-dialog-format'
import { DetailField } from '@/components/query-tables/detail-field'
import { formatDuration } from '@/components/query-tables/format-duration'
import { SortableHeader } from '@/components/query-tables/sortable-header'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import { buildExplorerQueryUrl } from '@/lib/explorer-url'
import { formatCompactNumber, formatReadableSize } from '@/lib/format-readable'
import { useHostId } from '@/lib/swr/use-host'
import { cn } from '@/lib/utils'

/**
 * Shape of a single `system.query_log` row as returned by the `slow-queries`
 * table API. Only the fields the view reads are typed; the index signature
 * keeps it tolerant of the extra `pct_*` / `readable_*` columns the query
 * also selects.
 */
export interface SlowQueryRow {
  query_id: string
  query: string
  query_start_time?: string
  query_duration?: number
  query_duration_ms?: number
  user?: string
  query_cache_usage?: string
  read_rows?: number
  readable_read_rows?: string
  read_bytes?: number
  readable_read_bytes?: string
  memory_usage?: number
  readable_memory_usage?: string
  pct_read_rows?: number
  pct_read_bytes?: number
  pct_memory_usage?: number
  [key: string]: unknown
}

// ───────────────────────── helpers ─────────────────────────

type Severity = 'critical' | 'warning' | 'normal'

/** Classify a query by how long it took (seconds). */
function getSeverity(durationS: number): Severity {
  if (durationS > 60) return 'critical'
  if (durationS > 10) return 'warning'
  return 'normal'
}

// formatDuration is imported from @/components/query-tables/format-duration

/** Toned chip for the query-cache usage enum. */
const CACHE_BADGE: Record<string, string> = {
  Hit: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  Write: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  Unknown: 'bg-muted text-muted-foreground',
  None: 'bg-muted text-muted-foreground',
}

function cacheBadgeClass(value: string): string {
  return CACHE_BADGE[value] ?? 'bg-muted text-muted-foreground'
}

// ───────────────────────── derived row ─────────────────────────

/**
 * A `SlowQueryRow` with every metric the view sorts or renders pre-computed
 * once, plus the rank assigned by the active sort (1 = worst).
 */
interface DerivedQuery {
  row: SlowQueryRow
  id: string
  query: string
  user: string
  cacheUsage: string
  startTime: string
  duration: number
  readableDuration: { value: string; unit: string }
  readRows: number
  readableReadRows: string
  pctReadRows: number
  readBytes: number
  readableReadBytes: string
  pctReadBytes: number
  memory: number
  readableMemory: string
  pctMemory: number
  severity: Severity
}

function derive(row: SlowQueryRow): DerivedQuery {
  const duration = Number(
    row.query_duration ??
      (row.query_duration_ms != null ? Number(row.query_duration_ms) / 1000 : 0)
  )
  const readRows = Number(row.read_rows ?? 0)
  const readBytes = Number(row.read_bytes ?? 0)
  const memory = Number(row.memory_usage ?? 0)

  return {
    row,
    id: String(row.query_id ?? ''),
    query: String(row.query ?? ''),
    user: String(row.user ?? ''),
    cacheUsage: String(row.query_cache_usage ?? '').trim(),
    startTime: String(row.query_start_time ?? ''),
    duration,
    readableDuration: formatDuration(duration),
    readRows,
    readableReadRows: row.readable_read_rows || formatCompactNumber(readRows),
    pctReadRows: Number(row.pct_read_rows ?? 0),
    readBytes,
    readableReadBytes: row.readable_read_bytes || formatReadableSize(readBytes),
    pctReadBytes: Number(row.pct_read_bytes ?? 0),
    memory,
    readableMemory: row.readable_memory_usage || formatReadableSize(memory),
    pctMemory: Number(row.pct_memory_usage ?? 0),
    severity: getSeverity(duration),
  }
}

// ───────────────────────── sorting ─────────────────────────

type SortKey = 'duration' | 'readRows' | 'readBytes' | 'memory'
type SortDir = 'asc' | 'desc'

const SORT_ACCESSOR: Record<SortKey, (d: DerivedQuery) => number> = {
  duration: (d) => d.duration,
  readRows: (d) => d.readRows,
  readBytes: (d) => d.readBytes,
  memory: (d) => d.memory,
}

// ───────────────────────── cells ─────────────────────────

const SEVERITY_DURATION: Record<Severity, string> = {
  critical: 'text-rose-600 dark:text-rose-400',
  warning: 'text-amber-600 dark:text-amber-400',
  normal: 'text-foreground',
}

/** Rank indicator — a quiet monochrome ordinal (1 = slowest). */
function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[11px] font-semibold tabular-nums text-muted-foreground"
      title={`Rank #${rank} by duration`}
    >
      {rank}
    </span>
  )
}

/** A toned cache-usage chip. */
function CacheBadge({ value }: { value: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide',
        cacheBadgeClass(value)
      )}
    >
      {value}
    </span>
  )
}

/** A compact metric bar (value + share of the slowest run). */
function MetricBar({ label, pct }: { label: string; pct: number }) {
  const width = Math.max(Math.min(pct, 100), 2)
  return (
    <div className="flex min-w-[72px] flex-col gap-1">
      <span className="truncate text-right text-xs font-medium tabular-nums">
        {label}
      </span>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-foreground/25 transition-all"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

// SortableHeader is imported from @/components/query-tables/sortable-header
// DetailField is imported from @/components/query-tables/detail-field

// ───────────────────────── expanded row ─────────────────────────

/**
 * Expanded row — secondary-metric grid, the full query with syntax
 * highlighting (via {@link CodeDialogFormat}), then row actions.
 */
function ExpandedDetail({ d }: { d: DerivedQuery }) {
  const hostId = useHostId()
  const explorerUrl = buildExplorerQueryUrl(d.query, hostId)
  const detailUrl = d.id
    ? `/query?query_id=${encodeURIComponent(d.id)}&host=${hostId}`
    : ''

  const fields: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    { label: 'Query ID', value: d.id },
    { label: 'User', value: d.user, mono: false },
    { label: 'Started', value: d.startTime, mono: false },
    { label: 'Cache', value: d.cacheUsage || '—', mono: false },
    {
      label: 'Duration',
      value: `${d.readableDuration.value} ${d.readableDuration.unit}`,
    },
    { label: 'Rows read', value: d.readableReadRows },
    { label: 'Data read', value: d.readableReadBytes },
    { label: 'Memory', value: d.readableMemory },
  ]

  return (
    <div className="space-y-3 border-t border-border bg-muted/40 px-3 py-3.5 sm:px-5">
      {/* Secondary metrics — a compact key/value grid */}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="border-b border-border bg-muted/40 px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Query metrics
        </div>
        <dl className="-ml-px -mt-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {fields.map((f) => (
            <DetailField
              key={f.label}
              label={f.label}
              value={f.value}
              mono={f.mono}
            />
          ))}
        </dl>
      </div>

      {/* Full query — syntax-highlighted dialog with EXPLAIN plan tab. */}
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Full query
        </div>
        <CodeDialogFormat
          value={d.query}
          options={{
            max_truncate: 280,
            hide_query_comment: true,
            force_dialog: true,
            show_query_plan: true,
            dialog_title: 'Slow Query',
            trigger_classname: 'w-full',
          }}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          render={<Link href={explorerUrl} />}
        >
          <ExternalLink className="size-3.5" />
          Open in Explorer
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5"
          disabled={!detailUrl}
          render={
            detailUrl ? (
              <Link href={detailUrl}>
                <ScanSearch className="size-3.5" />
                Query detail
              </Link>
            ) : (
              <span className="inline-flex h-7 items-center gap-1.5">
                <ScanSearch className="size-3.5" />
                Query detail
              </span>
            )
          }
        />
      </div>
    </div>
  )
}

// ───────────────────────── row ─────────────────────────

interface QueryRowProps {
  d: DerivedQuery
  rank: number
  expanded: boolean
  onToggle: () => void
}

/** One slow query rendered as a table row (collapsed) + detail row. */
const QueryRow = memo(function QueryRow({
  d,
  rank,
  expanded,
  onToggle,
}: QueryRowProps) {
  const dur = d.readableDuration

  return (
    <>
      <tr
        className="group cursor-pointer border-b border-border/60 align-middle transition-colors hover:bg-muted/50"
        onClick={onToggle}
      >
        {/* Rank + expand chevron */}
        <td className="px-2 py-2.5 sm:px-3">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <ChevronRight
              className={cn(
                'size-3 shrink-0 text-muted-foreground transition-transform',
                expanded && 'rotate-90'
              )}
            />
            <RankBadge rank={rank} />
          </div>
        </td>

        {/* Query text */}
        <td className="max-w-0 px-2 py-2.5 sm:px-3">
          <div className="truncate font-mono text-sm text-muted-foreground group-hover:text-foreground">
            {d.query}
          </div>
          {/* Compact metric row on small viewports where columns collapse. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground md:hidden">
            <span className="inline-flex items-center gap-1">
              <UserIcon className="size-3" />
              {d.user || 'anon'}
            </span>
            <span className="inline-flex items-center gap-1">
              <Rows3 className="size-3" />
              {d.readableReadRows}
            </span>
            <span className="inline-flex items-center gap-1">
              <Database className="size-3" />
              {d.readableReadBytes}
            </span>
            <span className="inline-flex items-center gap-1">
              <MemoryStick className="size-3" />
              {d.readableMemory}
            </span>
          </div>
        </td>

        {/* Duration — the headline metric */}
        <td className="px-2 py-2.5 text-right sm:px-3">
          <span
            className={cn(
              'whitespace-nowrap text-sm font-semibold tabular-nums',
              SEVERITY_DURATION[d.severity]
            )}
          >
            {dur.value}
            <span className="ml-0.5 font-normal text-muted-foreground">
              {dur.unit}
            </span>
          </span>
        </td>

        {/* User — hidden on small screens (shown inline under query) */}
        <td className="hidden px-2 py-2.5 sm:px-3 lg:table-cell">
          <span className="truncate text-sm">{d.user || 'anon'}</span>
        </td>

        {/* Cache usage */}
        <td className="hidden px-2 py-2.5 sm:px-3 xl:table-cell">
          <CacheBadge value={d.cacheUsage} />
        </td>

        {/* Rows read */}
        <td className="hidden px-2 py-2.5 sm:px-3 md:table-cell">
          <div className="flex justify-end">
            <MetricBar label={d.readableReadRows} pct={d.pctReadRows} />
          </div>
        </td>

        {/* Data read */}
        <td className="hidden px-2 py-2.5 sm:px-3 md:table-cell">
          <div className="flex justify-end">
            <MetricBar label={d.readableReadBytes} pct={d.pctReadBytes} />
          </div>
        </td>

        {/* Memory */}
        <td className="hidden px-2 py-2.5 sm:px-3 md:table-cell">
          <div className="flex justify-end">
            <MetricBar label={d.readableMemory} pct={d.pctMemory} />
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border">
          <td colSpan={8} className="p-0">
            <ExpandedDetail d={d} />
          </td>
        </tr>
      )}
    </>
  )
})

// ───────────────────────── table ─────────────────────────

export interface SlowQueriesTableProps {
  rows: SlowQueryRow[]
}

/**
 * SlowQueriesTable — a dense, sortable, responsive view of the slowest
 * `system.query_log` rows. Each row expands to reveal secondary metrics, the
 * full syntax-highlighted query, and per-row actions. The slowest queries are
 * highlighted via a rank badge + duration-severity heat accent.
 *
 * Columns progressively collapse on narrow viewports (the metric bars hide and
 * fold into a compact inline row under the query text), keeping the table
 * readable without heavy horizontal scrolling.
 */
export function SlowQueriesTable({ rows }: SlowQueriesTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('duration')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const derived = useMemo(() => rows.map(derive), [rows])

  // Rank is always assigned by duration (slowest = 1), independent of the
  // active sort, so the badge keeps emphasising the slowest queries.
  const rankById = useMemo(() => {
    const byDuration = [...derived].sort((a, b) => b.duration - a.duration)
    const map = new Map<DerivedQuery, number>()
    byDuration.forEach((d, i) => map.set(d, i + 1))
    return map
  }, [derived])

  const sorted = useMemo(() => {
    const accessor = SORT_ACCESSOR[sortKey]
    const factor = sortDir === 'desc' ? -1 : 1
    return [...derived].sort((a, b) => factor * (accessor(a) - accessor(b)))
  }, [derived, sortKey, sortDir])

  const handleSort = (key: string) => {
    const k = key as SortKey
    if (k === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(k)
      setSortDir('desc')
    }
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <SortableHeader width="64px">#</SortableHeader>
              <SortableHeader>Query</SortableHeader>
              <SortableHeader
                align="right"
                width="96px"
                sortKey="duration"
                activeKey={sortKey}
                dir={sortDir}
                onSort={handleSort}
              >
                <Clock className="size-3" />
                Duration
              </SortableHeader>
              <SortableHeader className="hidden lg:table-cell" width="120px">
                User
              </SortableHeader>
              <SortableHeader className="hidden xl:table-cell" width="80px">
                Cache
              </SortableHeader>
              <SortableHeader
                align="right"
                width="120px"
                className="hidden md:table-cell"
                sortKey="readRows"
                activeKey={sortKey}
                dir={sortDir}
                onSort={handleSort}
              >
                Rows read
              </SortableHeader>
              <SortableHeader
                align="right"
                width="120px"
                className="hidden md:table-cell"
                sortKey="readBytes"
                activeKey={sortKey}
                dir={sortDir}
                onSort={handleSort}
              >
                Data read
              </SortableHeader>
              <SortableHeader
                align="right"
                width="120px"
                className="hidden md:table-cell"
                sortKey="memory"
                activeKey={sortKey}
                dir={sortDir}
                onSort={handleSort}
              >
                Memory
              </SortableHeader>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d, index) => (
              <QueryRow
                key={d.id || `${index}-${d.query.slice(0, 32)}`}
                d={d}
                rank={rankById.get(d) ?? index + 1}
                expanded={expanded.has(d.id)}
                onToggle={() => toggle(d.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
