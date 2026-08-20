/**
 * Pure TTL / partition inventory health checks.
 *
 * No I/O. Used by the /ttl-partition-health page (row styling), the
 * /health TTL & Partition Health card, and the optional Insights collector.
 * Thresholds match the schema-design skill (~500–1000 partitions/table)
 * and issue #3074 acceptance.
 */

export const PARTITION_COUNT_WARNING = 500
export const PARTITION_COUNT_CRITICAL = 1000
export const PARTS_PER_PARTITION_WARNING = 10

/** ClickHouse date/time partition helpers — a table using these looks time-series. */
const TIME_BASED_PARTITION_RE =
  /toYYYYMM(DD(hhmmss)?)?|toStartOf(Day|Hour|Minute|Month|Week|Quarter|Year|Interval)|toDate(Time)?(\(|$)|toMonday|toYearWeek|toISOWeek|toStartOfISOYear/i

export type TtlPartitionSeverity = 'ok' | 'info' | 'warning' | 'critical'

export type TtlPartitionFlag =
  | 'too_many_partitions'
  | 'high_partition_count'
  | 'missing_ttl'
  | 'high_parts_per_partition'

export interface TtlPartitionInventoryRow {
  database: string
  table: string
  partitionKey: string
  ttlExpression: string
  partitions: number
  activeParts: number
}

export interface TtlPartitionHealth {
  flags: TtlPartitionFlag[]
  severity: TtlPartitionSeverity
}

export function isTimeBasedPartitionKey(partitionKey: string): boolean {
  const key = partitionKey.trim()
  if (!key) return false
  return TIME_BASED_PARTITION_RE.test(key)
}

export function hasTtlExpression(
  ttlExpression: string | null | undefined
): boolean {
  return Boolean(ttlExpression && ttlExpression.trim().length > 0)
}

export function evaluateTtlPartitionHealth(
  row: TtlPartitionInventoryRow
): TtlPartitionHealth {
  const flags: TtlPartitionFlag[] = []

  if (row.partitions >= PARTITION_COUNT_CRITICAL) {
    flags.push('too_many_partitions')
  } else if (row.partitions >= PARTITION_COUNT_WARNING) {
    flags.push('high_partition_count')
  }

  const partsPerPartition =
    row.partitions > 0 ? row.activeParts / row.partitions : 0
  if (partsPerPartition >= PARTS_PER_PARTITION_WARNING) {
    flags.push('high_parts_per_partition')
  }

  if (
    isTimeBasedPartitionKey(row.partitionKey) &&
    !hasTtlExpression(row.ttlExpression)
  ) {
    flags.push('missing_ttl')
  }

  return { flags, severity: severityFromFlags(flags) }
}

function severityFromFlags(flags: TtlPartitionFlag[]): TtlPartitionSeverity {
  if (flags.includes('too_many_partitions')) return 'critical'
  if (flags.includes('high_partition_count') || flags.includes('missing_ttl')) {
    return 'warning'
  }
  if (flags.includes('high_parts_per_partition')) return 'info'
  return 'ok'
}

export function ttlPartitionRowClassName(
  row: Record<string, unknown>
): string | undefined {
  const health = evaluateTtlPartitionHealth(inventoryRowFromQuery(row))
  if (health.severity === 'critical') {
    return 'bg-red-50 dark:bg-red-950/20'
  }
  if (health.severity === 'warning') {
    return 'bg-amber-50 dark:bg-amber-950/15'
  }
  return undefined
}

/** Human-readable flag list for inventory rows (empty when healthy). */
export function ttlPartitionFlagsLabel(row: Record<string, unknown>): string {
  return evaluateTtlPartitionHealth(inventoryRowFromQuery(row)).flags.join(', ')
}

export function inventoryRowFromQuery(
  row: Record<string, unknown>
): TtlPartitionInventoryRow {
  return {
    database: String(row.database ?? row._database ?? ''),
    table: String(row.table ?? row._table ?? ''),
    partitionKey: String(row.partition_key ?? ''),
    ttlExpression: String(row.ttl_expression ?? ''),
    partitions: Number(row.partitions) || 0,
    activeParts: Number(row.active_parts) || 0,
  }
}
