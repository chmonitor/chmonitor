/**
 * Does this host use replication at all? (issue #4044)
 *
 * `system.replication_queue` and `system.replicas` exist on every server but
 * only ever hold rows when a `Replicated*MergeTree` or `Shared*MergeTree`
 * table exists. On a host without any, an empty queue means "not applicable",
 * not "healthy", so queue surfaces show a neutral state and queue alert rules
 * are skipped instead of evaluated as OK.
 *
 * The question is answered from `system.tables.engine`, once per host through
 * the capability cache. A failed probe reports `true` (unknown, assume used),
 * the same fail-open rule `hasTable` follows.
 */

import type { AlertRuleDef } from '@/lib/alerting/rule-registry'
import type { HostCapabilities } from './capability-cache'

import { LOCAL_DATABASES_FILTER } from '@/lib/clickhouse-local-databases'

/** `SharedSet` / `SharedJoin` are not replicated, so match the MergeTree family. */
export const REPLICATED_ENGINE_PREDICATE = `(engine LIKE 'Replicated%' OR engine LIKE 'Shared%MergeTree')`

/** One row per host, for the browser to read through the chart API. */
export const REPLICATION_USAGE_SQL = `
    SELECT count() > 0 AS used
    FROM (
      SELECT 1 FROM system.tables
      WHERE ${REPLICATED_ENGINE_PREDICATE} AND ${LOCAL_DATABASES_FILTER}
      LIMIT 1
    )`

/** Scalar form of the same probe, for health chart queries that need the flag beside their value. */
export const REPLICATION_USED_SCALAR_SQL = `(SELECT count() > 0 FROM (
      SELECT 1 FROM system.tables
      WHERE ${REPLICATED_ENGINE_PREDICATE} AND ${LOCAL_DATABASES_FILTER}
      LIMIT 1
    ))`

/** The one neutral sentence every replication surface shows on a host without replication. */
export const REPLICATION_NOT_USED_MESSAGE = 'Replication not used on this host'

export function usesReplication(
  capabilities: Pick<HostCapabilities, 'replicationUsed'>
): boolean {
  return capabilities.replicationUsed
}

/**
 * Whether a rule should be evaluated on a host with these capabilities.
 * `null` capabilities mean the caller has none, so the rule runs.
 */
export function ruleAppliesToHost(
  rule: Pick<AlertRuleDef, 'requiresReplication'>,
  capabilities: Pick<HostCapabilities, 'replicationUsed'> | null
): boolean {
  if (!rule.requiresReplication) return true
  return capabilities === null || usesReplication(capabilities)
}
