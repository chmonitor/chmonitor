/**
 * Engine classification + overview formatting helpers for the Data Explorer.
 *
 * The Overview tab is engine-aware: a Dictionary has no parts, partitions or
 * compression, and a View has no storage at all. Rendering em-dash cards for
 * those metrics is noise, so classify the engine first and pick the card set.
 */

import { formatRelativeTime } from '@/lib/utils/format-relative-time'

export type EngineKind =
  | 'mergetree'
  | 'dictionary'
  | 'view'
  | 'materialized-view'
  | 'log'
  | 'integration'
  | 'other'

const INTEGRATION_ENGINES = new Set([
  'Distributed',
  'Kafka',
  'RabbitMQ',
  'NATS',
  'S3',
  'S3Queue',
  'URL',
  'HDFS',
  'MySQL',
  'PostgreSQL',
  'MongoDB',
  'SQLite',
  'ODBC',
  'JDBC',
  'Redis',
  'DeltaLake',
  'Iceberg',
  'Hudi',
  'File',
  'Merge',
  'Buffer',
])

/** Map a `system.tables.engine` value to a coarse kind. */
export function classifyEngine(engine: string | null | undefined): EngineKind {
  const name = (engine ?? '').trim()
  if (name === '') return 'other'

  if (name === 'Dictionary') return 'dictionary'
  if (name === 'MaterializedView') return 'materialized-view'
  if (name === 'View' || name === 'LiveView' || name === 'WindowView') {
    return 'view'
  }
  // Covers MergeTree, ReplicatedMergeTree, SharedReplacingMergeTree, ...
  if (name.endsWith('MergeTree')) return 'mergetree'
  if (name === 'Log' || name === 'TinyLog' || name === 'StripeLog') return 'log'
  if (INTEGRATION_ENGINES.has(name)) return 'integration'

  return 'other'
}

/** Engines that physically store parts (size / rows / parts / compression). */
export function hasPartStorage(kind: EngineKind): boolean {
  return kind === 'mergetree'
}

/** Human label for the object type, used in headers and empty states. */
export function engineKindLabel(kind: EngineKind): string {
  switch (kind) {
    case 'mergetree':
      return 'Table'
    case 'dictionary':
      return 'Dictionary'
    case 'view':
      return 'View'
    case 'materialized-view':
      return 'Materialized view'
    case 'log':
      return 'Log table'
    case 'integration':
      return 'Integration table'
    default:
      return 'Table'
  }
}

/**
 * Extract the target table of a materialized view from its CREATE statement
 * (`CREATE MATERIALIZED VIEW x TO db.target (...) AS SELECT ...`). Returns
 * null for an inner-table MV (`ENGINE = ...`), which has no explicit target.
 */
export function parseMaterializedViewTarget(
  createQuery: string | null | undefined
): string | null {
  if (typeof createQuery !== 'string' || createQuery.trim() === '') return null

  const match = createQuery.match(
    /\bTO\s+((?:`[^`]+`|[A-Za-z_][\w$]*)(?:\.(?:`[^`]+`|[A-Za-z_][\w$]*))?)/i
  )
  if (!match) return null

  return match[1].replace(/`/g, '')
}

/**
 * ClickHouse returns "no value" datetimes as the epoch string
 * `1970-01-01 00:00:00`. Parsing that yields a non-zero ms value once the
 * local timezone offset is applied, so detect it by year, not by `getTime()`.
 */
export function isEpochZero(value: unknown): boolean {
  if (typeof value === 'string') {
    if (value.trim().startsWith('1970-01-01')) return true
  }
  const date = toDate(value)
  return date !== null && date.getUTCFullYear() < 1971
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date =
    typeof value === 'number' ? new Date(value) : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

export interface FormattedTimestamp {
  /** Short relative text ("3h ago") or the fallback for missing values. */
  relative: string
  /** Full locale timestamp for a tooltip / sub-line, or null when missing. */
  absolute: string | null
}

/**
 * Format a ClickHouse datetime as relative + absolute. Missing values and
 * epoch-zero both render as `fallback` (default "never") — never as
 * `1/1/1970, 12:00:00 AM`.
 */
export function formatTimestamp(
  value: unknown,
  fallback = 'never'
): FormattedTimestamp {
  if (isEpochZero(value)) return { relative: fallback, absolute: null }

  const date = toDate(value)
  if (date === null) return { relative: fallback, absolute: null }

  return {
    relative: formatRelativeTime(date.getTime()),
    absolute: date.toLocaleString(),
  }
}
