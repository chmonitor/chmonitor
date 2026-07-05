import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  ExternalLink,
  HardDrive,
  ListTree,
  MemoryStick,
  RowsIcon,
  Server,
  User as UserIcon,
} from 'lucide-react'

import { useState } from 'react'
import { KpiCard } from '@/components/overview-charts/kpi-card'
import { TableSkeleton } from '@/components/skeletons'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import { buildExplorerQueryUrl } from '@/lib/explorer-url'
import { formatReadableSize } from '@/lib/format-readable'
import { useTableData } from '@/lib/query/use-table-data'
import { useHostId } from '@/lib/swr/use-host'
import { buildUrl } from '@/lib/url/url-builder'
import { cn } from '@/lib/utils'

// ──────────────────────────── types ────────────────────────────

/**
 * Shape of a row from `system.query_log` as returned by the
 * `query-detail` query config. Only the fields this component reads
 * are typed here; the index signature keeps it tolerant of extras.
 */
interface QueryDetailRow {
  query_id?: string
  type?: string
  event_time?: string
  query_start_time?: string
  query_finish_time?: string
  query_duration?: number | string
  query?: string
  readable_query?: string
  exception_code?: number | string
  exception_text?: string
  stack_trace?: string
  user?: string
  query_kind?: string
  is_initial_query?: number | boolean
  databases?: string
  tables?: string
  read_rows?: number | string
  readable_read_rows?: string
  written_rows?: number | string
  readable_written_rows?: string
  result_rows?: number | string
  readable_result_rows?: string
  memory_usage?: number | string
  readable_memory_usage?: string
  peak_memory_usage?: number | string
  readable_peak_memory_usage?: string
  read_bytes?: number | string
  readable_read_bytes?: string
  written_bytes?: number | string
  writable_written_bytes?: string
  client_name?: string
  client_hostname?: string
  initial_user?: string
  initial_query_id?: string
  initial_address?: string
  interfaces?: string
  ProfileEvents?: Record<string, number | string>
  Settings?: Record<string, string>
  [key: string]: unknown
}

// ──────────────────────────── helpers ────────────────────────────

const KIND_BADGE: Record<string, string> = {
  Select: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  Insert:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  Create:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Optimize:
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  Alter:
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  Drop: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  Delete: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
}

function kindBadgeClass(kind: string): string {
  return KIND_BADGE[kind] ?? 'bg-muted text-muted-foreground'
}

const TYPE_BADGE: Record<string, string> = {
  QueryFinish:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  QueryStart:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  ExceptionWhileProcessing:
    'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  ExceptionBeforeStart:
    'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
}

function typeBadgeClass(type: string): string {
  return TYPE_BADGE[type] ?? 'bg-muted text-muted-foreground'
}

function toNumber(v: unknown): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function toStr(v: unknown): string {
  if (v == null) return ''
  return String(v)
}

/**
 * Format query_duration from seconds (float) into a human-readable string.
 */
function formatDurationSeconds(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return '0.0s'
  if (secs < 60) return `${secs.toFixed(2)}s`
  const m = Math.floor(secs / 60)
  const s = (secs % 60).toFixed(1)
  return `${m}m ${s}s`
}

// ──────────────────────────── sub-components ────────────────────────────

/** Compact labeled value in the header card info grid. */
function MetaField({
  label,
  value,
  mono = false,
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="size-3" />}
        {label}
      </dt>
      <dd
        className={cn(
          'truncate text-[12.5px] font-medium',
          mono && 'font-mono'
        )}
      >
        {value || '—'}
      </dd>
    </div>
  )
}

/** Expandable card for ProfileEvents or Settings map data. */
const CollapsibleSection = function CollapsibleSection({
  title,
  entries,
}: {
  title: string
  entries: [string, string][]
}) {
  const [open, setOpen] = useState(false)

  if (entries.length === 0) return null

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="text-[12.5px] font-semibold">{title}</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
          {open ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-border">
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
            {entries.map(([key, val]) => (
              <div
                key={key}
                className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-2 text-[11.5px] last:border-b-0 sm:border-b"
              >
                <span className="min-w-0 truncate font-mono text-muted-foreground">
                  {key}
                </span>
                <span className="shrink-0 font-mono font-medium tabular-nums">
                  {val}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Inline SQL block with copy-to-clipboard. Not a modal — beautify off by default per project rule. */
function SqlBlock({ query }: { query: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText)
      return
    try {
      await navigator.clipboard.writeText(query)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* noop */
    }
  }

  const lineCount = (query.match(/\n/g)?.length ?? 0) + 1

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          SQL
        </span>
        <div className="flex items-center gap-3">
          <span className="text-[10.5px] tabular-nums text-muted-foreground">
            {query.length.toLocaleString()} chars · {lineCount}{' '}
            {lineCount === 1 ? 'line' : 'lines'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-muted-foreground"
            onClick={handleCopy}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
      <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11.5px] leading-relaxed text-foreground">
        {query}
      </pre>
    </div>
  )
}

// ──────────────────────────── main component ────────────────────────────

interface QueryDetailViewProps {
  queryId: string
}

/**
 * QueryDetailView — redesigned query detail page using the CHM design system.
 *
 * Sections:
 *  1. Header card — query_id, status/type badge, user, times, host
 *  2. Metrics strip — KpiCards for duration, read rows, read bytes, memory
 *  3. SQL block — inline, no modal; beautify off by default
 *  4. ProfileEvents + Settings — collapsible sections
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

  const row = data?.[0]

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

  // ── Derived values ──
  const type = toStr(row.type)
  const kind = toStr(row.query_kind)
  const user = toStr(row.user)
  const queryText = toStr(row.query)
  const eventTime = toStr(row.event_time)
  const startTime = toStr(row.query_start_time)
  const finishTime = toStr(row.query_finish_time)
  const databases = toStr(row.databases)
    .replace(/^\[?\s*|\s*\]?,?\s*$/g, '')
    .trim()
  const tables = toStr(row.tables)
    .replace(/^\[?\s*|\s*\]?,?\s*$/g, '')
    .trim()
  const clientName = toStr(row.client_name)
  const clientHost = toStr(row.client_hostname)

  const durationSecs = toNumber(row.query_duration)
  const readRows = toNumber(row.read_rows)
  const readBytes = toNumber(row.read_bytes)
  const memoryUsage = toNumber(row.memory_usage)
  const peakMemory = toNumber(row.peak_memory_usage)
  const writtenRows = toNumber(row.written_rows)
  const resultRows = toNumber(row.result_rows)

  const readableReadRows =
    toStr(row.readable_read_rows) || readRows.toLocaleString()
  const readableReadBytes =
    toStr(row.readable_read_bytes) || formatReadableSize(readBytes)
  const readableMemory =
    toStr(row.readable_memory_usage) || formatReadableSize(memoryUsage)
  const readablePeakMemory =
    toStr(row.readable_peak_memory_usage) || formatReadableSize(peakMemory)

  const hasException = Boolean(
    row.exception_code && Number(row.exception_code) !== 0
  )

  const explorerUrl = buildExplorerQueryUrl(queryText, hostId)

  return (
    <div className="flex flex-col gap-4">
      {/* ── 1. Header card ── */}
      <div className="overflow-hidden rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* Left: id + badges */}
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-[13px] font-semibold text-foreground/90">
              {queryId}
            </code>
            {type && (
              <span
                className={cn(
                  'inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide',
                  typeBadgeClass(type)
                )}
              >
                {type}
              </span>
            )}
            {kind && (
              <span
                className={cn(
                  'inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide',
                  kindBadgeClass(kind)
                )}
              >
                {kind}
              </span>
            )}
            {hasException && (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                <AlertCircle className="size-3" />
                Error {toStr(row.exception_code)}
              </span>
            )}
          </div>

          {/* Right: actions */}
          {queryText && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5"
                render={
                  <Link
                    href={buildUrl('/explain', {
                      query_id: queryId,
                      host: hostId,
                    })}
                  />
                }
              >
                <ListTree className="size-3.5" />
                Explain query
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5"
                render={<Link href={explorerUrl} />}
              >
                <ExternalLink className="size-3.5" />
                Open in Explorer
              </Button>
            </div>
          )}
        </div>

        {/* Meta grid */}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {user && <MetaField label="User" value={user} icon={UserIcon} />}
          {eventTime && (
            <MetaField label="Logged at" value={eventTime} icon={Clock} />
          )}
          {startTime && startTime !== eventTime && (
            <MetaField label="Started" value={startTime} icon={Clock} />
          )}
          {finishTime && (
            <MetaField label="Finished" value={finishTime} icon={Clock} />
          )}
          {databases && (
            <MetaField label="Databases" value={databases} icon={Database} />
          )}
          {tables && <MetaField label="Tables" value={tables} icon={Server} />}
          {clientName && <MetaField label="Client" value={clientName} />}
          {clientHost && <MetaField label="Client host" value={clientHost} />}
        </dl>

        {/* Exception text */}
        {hasException && row.exception_text && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 dark:border-rose-900/40 dark:bg-rose-950/20">
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              Exception
            </p>
            <pre className="max-h-[120px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-rose-700 dark:text-rose-300">
              {toStr(row.exception_text)}
            </pre>
          </div>
        )}
      </div>

      {/* ── 2. Metrics strip ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={Clock}
          tone="amber"
          label="Duration"
          value={formatDurationSeconds(durationSecs)}
          sub={`${durationSecs.toFixed(3)}s raw`}
        />
        <KpiCard
          icon={RowsIcon}
          tone="blue"
          label="Rows read"
          value={readableReadRows}
          sub={
            writtenRows > 0
              ? `${toStr(row.readable_written_rows) || writtenRows.toLocaleString()} written`
              : resultRows > 0
                ? `${toStr(row.readable_result_rows) || resultRows.toLocaleString()} result`
                : undefined
          }
        />
        <KpiCard
          icon={HardDrive}
          tone="violet"
          label="Data read"
          value={readableReadBytes}
          sub={
            toStr(row.writable_written_bytes)
              ? `${toStr(row.writable_written_bytes)} written`
              : undefined
          }
        />
        <KpiCard
          icon={MemoryStick}
          tone="green"
          label="Memory"
          value={readableMemory}
          sub={
            peakMemory > 0 && peakMemory !== memoryUsage
              ? `peak ${readablePeakMemory}`
              : undefined
          }
        />
      </div>

      {/* ── 3. SQL block ── */}
      {queryText && <SqlBlock query={queryText} />}

      {/* ── 4. ProfileEvents + Settings ── */}
      {profileEntries.length > 0 && (
        <CollapsibleSection title="Profile Events" entries={profileEntries} />
      )}
      {settingsEntries.length > 0 && (
        <CollapsibleSection title="Query Settings" entries={settingsEntries} />
      )}
    </div>
  )
}
