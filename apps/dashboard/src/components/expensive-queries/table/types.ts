import { formatCompactNumber } from '@/lib/format-readable'

/**
 * Shape of a single `expensive-queries` row — one normalized query fingerprint
 * aggregated over the last 24h of `system.query_log`. Only the fields the
 * table reads are typed; the index signature tolerates the long tail of
 * ProfileEvents-derived columns the config also selects.
 */
export interface ExpensiveQueryRow {
  normalized_query_hash?: string | number
  query: string
  query_cache_usage?: string
  cnt?: number
  queries_duration?: number
  real_time?: number
  user_time?: number
  system_time?: number
  disk_read_time?: number
  disk_write_time?: number
  network_send_time?: number
  network_receive_time?: number
  zookeeper_wait_time?: number
  os_io_wait_time?: number
  os_cpu_wait_time?: number
  os_cpu_virtual_time?: number
  network_receive_bytes?: string
  network_send_bytes?: string
  selected_rows?: number
  selected_parts?: number
  selected_marks?: number
  selected_ranges?: number
  file_open?: number
  zookeeper_transactions?: number
  memory_usage_q97?: number
  readable_memory_usage_q97?: string
  read_rows?: number
  written_rows?: number
  result_rows?: number
  read_bytes?: string
  written_bytes?: string
  result_bytes?: string
  [key: string]: unknown
}

export type Severity = 'critical' | 'warning' | 'normal'

function getSeverity(queriesDuration: number): Severity {
  if (queriesDuration > 30) return 'critical'
  if (queriesDuration > 5) return 'warning'
  return 'normal'
}

export function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * An `ExpensiveQueryRow` with the metrics the table sorts / filters / renders
 * pre-computed once. `rank` is the row's 1-based position in the *original*
 * order (most expensive first), so the "#1 / #2 …" badges survive re-sorting.
 */
export interface DerivedQuery {
  row: ExpensiveQueryRow
  key: string
  rank: number
  query: string
  cacheUsage: string | null
  cnt: number
  queriesDuration: number
  userTime: number
  systemTime: number
  realTime: number
  memory: number
  readableMemory: string
  readRows: number
  writtenRows: number
  resultRows: number
  selectedRows: number
  readBytes: string
  writtenBytes: string
  resultBytes: string
  severity: Severity
}

export function derive(row: ExpensiveQueryRow, index: number): DerivedQuery {
  const query = String(row.query ?? '')
  const hash = row.normalized_query_hash
  const key = hash != null && hash !== '' ? String(hash) : `idx-${index}`
  const queriesDuration = num(row.queries_duration)
  const memory = num(row.memory_usage_q97)

  return {
    row,
    key,
    rank: index + 1,
    query,
    cacheUsage:
      row.query_cache_usage != null && row.query_cache_usage !== ''
        ? String(row.query_cache_usage)
        : null,
    cnt: num(row.cnt),
    queriesDuration,
    userTime: num(row.user_time),
    systemTime: num(row.system_time),
    realTime: num(row.real_time),
    memory,
    readableMemory:
      row.readable_memory_usage_q97 || formatCompactNumber(memory),
    readRows: num(row.read_rows),
    writtenRows: num(row.written_rows),
    resultRows: num(row.result_rows),
    selectedRows: num(row.selected_rows),
    readBytes: String(row.read_bytes ?? '—'),
    writtenBytes: String(row.written_bytes ?? '—'),
    resultBytes: String(row.result_bytes ?? '—'),
    severity: getSeverity(queriesDuration),
  }
}

export type SortKey =
  | 'rank'
  | 'cnt'
  | 'duration'
  | 'cpu'
  | 'memory'
  | 'readRows'

export type SortDir = 'asc' | 'desc'

export const SORT_ACCESSOR: Record<SortKey, (d: DerivedQuery) => number> = {
  rank: (d) => -d.rank,
  cnt: (d) => d.cnt,
  duration: (d) => d.queriesDuration,
  cpu: (d) => d.userTime,
  memory: (d) => d.memory,
  readRows: (d) => d.readRows,
}

export type OptionalColumn = 'cnt' | 'cpu' | 'memory' | 'readRows'

export const OPTIONAL_COLUMNS: { key: OptionalColumn; label: string }[] = [
  { key: 'cnt', label: 'Runs' },
  { key: 'cpu', label: 'CPU time' },
  { key: 'memory', label: 'Memory' },
  { key: 'readRows', label: 'Rows read' },
]

export const BASE_COLUMN_COUNT = 4

export const SEVERITY_DURATION: Record<Severity, string> = {
  critical: 'text-rose-600 dark:text-rose-400 font-semibold',
  warning: 'text-amber-600 dark:text-amber-400 font-medium',
  normal: '',
}
