import { formatCompactNumber, formatReadableSize } from '@/lib/format-readable'

export interface RunningQueryRow {
  query_id: string
  query: string
  query_kind?: string
  user?: string
  current_database?: string
  interface?: string
  address?: string
  port?: number
  initial_address?: string
  client_name?: string
  client_hostname?: string
  os_user?: string
  initial_query_id?: string
  is_initial_query?: number | boolean
  distributed_depth?: number
  elapsed?: number
  readable_elapsed?: string
  read_rows?: number
  read_bytes?: number
  readable_read_rows?: string
  written_rows?: number
  written_bytes?: number
  readable_written_rows?: string
  total_rows_approx?: number
  readable_total_rows_approx?: string
  memory_usage?: number
  peak_memory_usage?: number
  readable_memory_usage?: string
  readable_peak_memory_usage?: string
  peak_threads_usage?: number
  thread_count?: number
  thread_ids?: unknown[]
  pct_progress?: number
  ProfileEvents?: Record<string, number>
  [key: string]: unknown
}

export type Severity = 'critical' | 'warning' | 'normal'

function getSeverity(elapsed: number): Severity {
  if (elapsed > 30) return 'critical'
  if (elapsed > 5) return 'warning'
  return 'normal'
}

/**
 * `system.processes.interface` is a UInt8 enum (ClientInfo::Interface).
 * Map it back to a readable protocol name; fall back to the raw value.
 */
const INTERFACE_NAMES: Record<string, string> = {
  '1': 'TCP',
  '2': 'HTTP',
  '3': 'gRPC',
  '4': 'MySQL',
  '5': 'PostgreSQL',
  '6': 'Local',
  '7': 'TCP Interserver',
  '8': 'Prometheus',
}

function interfaceName(value: unknown): string | null {
  if (value == null || value === '' || value === 0) return null
  return INTERFACE_NAMES[String(value)] ?? String(value)
}

function profileEvent(events: unknown, key: string): number {
  if (events && typeof events === 'object' && !Array.isArray(events)) {
    const value = (events as Record<string, unknown>)[key]
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/**
 * A `RunningQueryRow` with every metric the table sorts, filters, or renders
 * pre-computed once. `pct` is the *effective* progress: the server-reported
 * percentage when known, a rows-read ratio as a fallback, or `null` when the
 * query gives no signal (rendered as an indeterminate bar).
 */
export interface DerivedQuery {
  row: RunningQueryRow
  id: string
  key: string
  kind: string
  query: string
  user: string
  db: string
  iface: string | null
  elapsed: number
  readableElapsed: string
  pct: number | null
  readRows: number
  readableReadRows: string
  totalRows: number
  readableTotalRows: string
  memory: number
  readableMemory: string
  peakMemory: number
  readBytes: number
  writtenRows: number
  writtenBytes: number
  cores: number
  cpuPct: number
  threads: number
  severity: Severity
}

export function derive(row: RunningQueryRow): DerivedQuery {
  const queryId = String(row.query_id ?? '')
  const queryText = String(row.query ?? '')
  const fallbackKeyParts = [
    row.user || 'anon',
    row.current_database || 'default',
    row.interface || 'unknown',
    row.address || 'unknown',
    row.port?.toString() || '0',
    queryText.slice(0, 64),
  ].map((value) => String(value).trim())

  const key = queryId || fallbackKeyParts.join('|')

  const elapsed = Number(row.elapsed ?? 0)
  const readRows = Number(row.read_rows ?? 0)
  const totalRows = Number(row.total_rows_approx ?? 0)

  // Effective progress — prefer the server %, fall back to a rows ratio.
  const reportedPct = Number(row.pct_progress ?? 0)
  let pct: number | null = null
  if (reportedPct > 0) {
    pct = Math.min(100, reportedPct)
  } else if (totalRows > 0 && readRows > 0) {
    pct = Math.min(100, Math.round((readRows / totalRows) * 100))
  }

  const threads =
    Number(row.peak_threads_usage ?? 0) ||
    Number(row.thread_count ?? 0) ||
    (Array.isArray(row.thread_ids) ? row.thread_ids.length : 0)

  // CPU is only exposed through ProfileEvents. `cores` is the average number
  // of cores burned; `cpuPct` is how saturated the query's own threads are.
  // Prefer the virtualized CPU counter; fall back to user + system time only
  // when it is absent (profileEvent returns 0 for missing keys).
  const events = row.ProfileEvents
  const cpuVirtual = profileEvent(events, 'OSCPUVirtualTimeMicroseconds')
  const cpuMicros =
    cpuVirtual > 0
      ? cpuVirtual
      : profileEvent(events, 'UserTimeMicroseconds') +
        profileEvent(events, 'SystemTimeMicroseconds')
  const cores = elapsed > 0 ? cpuMicros / 1e6 / elapsed : 0
  const cpuPct = threads > 0 ? Math.min(100, (cores / threads) * 100) : 0

  const memory = Number(row.memory_usage ?? 0)

  return {
    row,
    id: queryId,
    key,
    kind: row.query_kind || 'Query',
    query: String(row.query ?? ''),
    user: String(row.user ?? ''),
    db: String(row.current_database ?? ''),
    iface: interfaceName(row.interface),
    elapsed,
    readableElapsed: row.readable_elapsed || `${elapsed.toFixed(1)}s`,
    pct,
    readRows,
    readableReadRows: row.readable_read_rows || formatCompactNumber(readRows),
    totalRows,
    readableTotalRows:
      row.readable_total_rows_approx || formatCompactNumber(totalRows),
    memory,
    // Base size only — `readable_memory_usage` can carry a "(peak …)" suffix
    // that overflows the fixed-width Memory column.
    readableMemory: formatReadableSize(memory),
    peakMemory: Number(row.peak_memory_usage ?? 0),
    readBytes: Number(row.read_bytes ?? 0),
    writtenRows: Number(row.written_rows ?? 0),
    writtenBytes: Number(row.written_bytes ?? 0),
    cores,
    cpuPct,
    threads,
    severity: getSeverity(elapsed),
  }
}

export type SortKey =
  | 'progress'
  | 'memory'
  | 'dataRead'
  | 'cpu'
  | 'threads'
  | 'duration'
export type SortDir = 'asc' | 'desc'

export const SORT_ACCESSOR: Record<SortKey, (d: DerivedQuery) => number> = {
  // Indeterminate progress sorts as 0 — it groups with "no measurable
  // progress yet" rather than below it via an arbitrary sentinel.
  progress: (d) => d.pct ?? 0,
  memory: (d) => d.memory,
  dataRead: (d) => d.readBytes,
  cpu: (d) => d.cpuPct,
  threads: (d) => d.threads,
  duration: (d) => d.elapsed,
}

export type OptionalColumn =
  | 'memory'
  | 'dataRead'
  | 'cpu'
  | 'threads'
  | 'duration'

export const OPTIONAL_COLUMNS: { key: OptionalColumn; label: string }[] = [
  { key: 'memory', label: 'Memory' },
  { key: 'dataRead', label: 'Data' },
  { key: 'cpu', label: 'CPU' },
  { key: 'threads', label: 'Threads' },
  { key: 'duration', label: 'Duration' },
]

export const BASE_COLUMN_COUNT = 4

export const SEVERITY_DURATION: Record<Severity, string> = {
  critical: 'text-rose-600 dark:text-rose-400 font-semibold',
  warning: 'text-amber-600 dark:text-amber-400 font-medium',
  normal: '',
}
