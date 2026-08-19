/**
 * TTL / partition inventory insight collector.
 *
 * SQL lives in query-config; this file maps rows to InsightCandidate.
 */

import type { InsightCandidate } from './types'

import { readOnlyQuery } from '../ai/agent/tools/helpers'
import {
  evaluateTtlPartitionHealth,
  type TtlPartitionInventoryRow,
  ttlPartitionFlagsLabel,
} from '../health/ttl-partition-heuristics'
import { ttlPartitionInventorySql } from '../query-config/system/ttl-partition-health'

export function rowFromTtlInventoryRecord(
  rec: Record<string, unknown>
): TtlPartitionInventoryRow {
  return {
    database: String(rec.database ?? ''),
    table: String(rec.table ?? rec.name ?? ''),
    partitionKey: String(rec.partition_key ?? ''),
    ttlExpression: String(rec.ttl_expression ?? ''),
    partitions: Number(rec.partitions) || 0,
    activeParts: Number(rec.active_parts) || 0,
  }
}

/** Worst flagged row → at most one storage insight. */
export function insightFromTtlInventoryRows(rows: unknown): InsightCandidate[] {
  if (!Array.isArray(rows)) return []

  const flagged: {
    row: TtlPartitionInventoryRow
    severity: 'warning' | 'critical'
    flags: string
  }[] = []
  for (const raw of rows) {
    const rec = raw as Record<string, unknown>
    const row = rowFromTtlInventoryRecord(rec)
    const health = evaluateTtlPartitionHealth(row)
    if (health.severity === 'warning' || health.severity === 'critical') {
      flagged.push({
        row,
        severity: health.severity,
        flags: ttlPartitionFlagsLabel(rec),
      })
    }
  }
  if (flagged.length === 0) return []

  flagged.sort((a, b) => b.row.partitions - a.row.partitions)
  const worst = flagged[0]
  const fq = `${worst.row.database}.${worst.row.table}`
  return [
    {
      severity: worst.severity,
      category: 'storage',
      metric: 'ttl_partition_health',
      title: `${fq} needs TTL or partition review`,
      detail: `${fq} has ${worst.row.partitions} partitions (${worst.row.activeParts} active parts); ${worst.flags}. Open TTL & Partitions for the full inventory. This is recommend-only — no ALTER TTL is applied.`,
      value: worst.row.partitions,
      action: {
        label: 'View TTL inventory',
        href: '/ttl-partition-health',
      },
    },
  ]
}

export async function collectTtlPartitionHealth(
  hostId: number
): Promise<InsightCandidate[]> {
  try {
    const rows = await readOnlyQuery({
      query: ttlPartitionInventorySql,
      hostId,
    })
    return insightFromTtlInventoryRows(rows)
  } catch {
    return []
  }
}
