/**
 * I/O orchestrator for the alert-suggestion engine (issue #2667).
 *
 * Gathers the four signal sources per host and hands them to the PURE scorer in
 * `alert-suggestions.ts`. Kept separate from that module so the heuristics stay
 * unit-testable without pulling in the ClickHouse client / D1 / insights store.
 *
 * Everything here is best-effort and read-only: a failed probe on one host or
 * one metric is skipped, never fatal, mirroring `current-findings.ts`. A short
 * per-owner TTL cache keeps the GET endpoint cheap under repeated polling.
 */

import type { ClickHouseConfig } from '@chm/clickhouse-client'
import type {
  AlertSuggestion,
  BaselineSignal,
  ClusterShape,
  HostSignals,
  RecurringFindingSignal,
} from './alert-suggestions'
import type { MetricKey } from './rule-builder-schema'

import { listDismissedSuggestionKeys } from './alert-suggestion-dismissals-store'
import { buildSuggestions } from './alert-suggestions'
import { listCustomRules } from './custom-rules-store'
import { METRIC_CATALOG } from './rule-builder-schema'
import { fetchData, getClickHouseConfigs } from '@chm/clickhouse-client'
import { debug } from '@chm/logger'
import { listBaselines } from '@/lib/insights/baseline-store'
import { resolveInsightsStore } from '@/lib/insights/store/resolve-store'

const CATALOG_KEYS = Object.keys(METRIC_CATALOG) as MetricKey[]

/** Lookback window for recurring insight findings. */
const FINDINGS_LOOKBACK = '7 DAY'
/** A finding must recur at least this many times to count as "recurring". */
const RECURRENCE_THRESHOLD = 2

/** TTL for the compute cache (ms). Suggestions move slowly; keep GET cheap. */
const CACHE_TTL_MS = 60_000

interface CacheEntry {
  at: number
  value: AlertSuggestion[]
}
const cache = new Map<string, CacheEntry>()

function hostLabel(config: ClickHouseConfig): string {
  return config.customName?.trim() || config.host
}

/**
 * Normalize an arbitrary baseline/finding metric string to a catalog key.
 * Matches the catalog key directly first, then a small alias table (collectors
 * and baselines use their own metric ids). Returns null when nothing maps —
 * unknown metrics are silently ignored, never guessed.
 */
const METRIC_ALIASES: Record<string, MetricKey> = {
  'replication-lag': 'replication-max-lag',
  'absolute-delay': 'replication-max-lag',
  'max-lag': 'replication-max-lag',
  'readonly-replica': 'readonly-replicas',
  'disk-usage': 'disk-usage-percent',
  'disk-percent': 'disk-usage-percent',
  'failed-mutation': 'failed-mutations',
  'stuck-merge': 'stuck-merges',
  'active-mutation': 'active-mutations',
  'long-running-query': 'long-running-queries',
  'running-query': 'running-queries',
  'parts-per-partition': 'parts-per-partition-max',
  'replication-queue': 'replication-queue-max',
}

export function mapToMetricKey(raw: string): MetricKey | null {
  const norm = raw.trim().toLowerCase().replace(/_/g, '-')
  if (!norm) return null
  if ((CATALOG_KEYS as string[]).includes(norm)) return norm as MetricKey
  return METRIC_ALIASES[norm] ?? null
}

async function runReadonly<T>(
  sql: string,
  hostId: number
): Promise<T[] | null> {
  try {
    const result = await fetchData<T[]>({
      query: sql,
      hostId,
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: '1' },
    })
    if (result.error) return null
    return Array.isArray(result.data) ? result.data : null
  } catch {
    return null
  }
}

async function getExistingSystemTables(
  hostId: number
): Promise<Set<string> | null> {
  const rows = await runReadonly<{ full: string }>(
    `SELECT concat(database, '.', name) AS full FROM system.tables WHERE database = 'system'`,
    hostId
  )
  if (!rows) return null
  return new Set(rows.map((r) => String(r.full)))
}

async function probeClusterShape(hostId: number): Promise<ClusterShape | null> {
  const rows = await runReadonly<{
    replicated_tables: unknown
    disks: unknown
  }>(
    `SELECT
       (SELECT count() FROM system.replicas) AS replicated_tables,
       (SELECT count() FROM system.disks) AS disks`,
    hostId
  )
  const row = rows?.[0]
  if (!row) return null
  return {
    replicatedTables: Number(row.replicated_tables) || 0,
    disks: Number(row.disks) || 0,
  }
}

/** Sample the current value of every catalog metric whose table exists. */
async function probeMetricValues(
  hostId: number,
  tables: Set<string> | null
): Promise<Partial<Record<MetricKey, number>>> {
  const values: Partial<Record<MetricKey, number>> = {}
  for (const metric of CATALOG_KEYS) {
    const entry = METRIC_CATALOG[metric]
    if (entry.tableCheck && tables && !tables.has(entry.tableCheck)) continue
    const rows = await runReadonly<Record<string, unknown>>(entry.sql, hostId)
    const raw = rows?.[0]?.[entry.valueKey]
    if (raw === null || raw === undefined) continue
    const num = Number(raw)
    if (Number.isFinite(num)) values[metric] = num
  }
  return values
}

async function gatherBaselines(
  hostId: number
): Promise<Partial<Record<MetricKey, BaselineSignal>>> {
  const out: Partial<Record<MetricKey, BaselineSignal>> = {}
  try {
    const baselines = await listBaselines(String(hostId))
    for (const b of baselines) {
      const metric = mapToMetricKey(b.metric)
      // First baseline that maps to a given catalog key wins (listBaselines is
      // ordered by metric name, deterministic).
      if (metric && !out[metric]) {
        out[metric] = {
          mean: b.mean,
          stddev: b.stddev,
          sampleCount: b.sampleCount,
        }
      }
    }
  } catch (err) {
    debug('[alert-suggestions] baseline gather failed', String(err))
  }
  return out
}

async function gatherRecurringFindings(
  hostId: number
): Promise<Partial<Record<MetricKey, RecurringFindingSignal>>> {
  const out: Partial<Record<MetricKey, RecurringFindingSignal>> = {}
  try {
    const store = await resolveInsightsStore()
    const rows = await store.list(hostId, {
      since: FINDINGS_LOOKBACK,
      limit: 500,
    })
    // rows are newest-first; count per mapped metric, keep the newest title.
    for (const row of rows) {
      const metric = mapToMetricKey(row.metric || row.category || '')
      if (!metric) continue
      const existing = out[metric]
      if (existing) {
        existing.count += 1
      } else {
        out[metric] = { count: 1, lastTitle: row.title }
      }
    }
  } catch (err) {
    debug('[alert-suggestions] findings gather failed', String(err))
  }
  // Drop below-threshold recurrences so the scorer only sees genuine repeats.
  for (const metric of Object.keys(out) as MetricKey[]) {
    if ((out[metric]?.count ?? 0) < RECURRENCE_THRESHOLD) delete out[metric]
  }
  return out
}

/** Catalog metrics already covered by a custom rule for this owner. */
async function existingRuleMetrics(ownerId: string): Promise<Set<MetricKey>> {
  const set = new Set<MetricKey>()
  try {
    const rules = await listCustomRules(ownerId)
    for (const rule of rules) {
      const metric = mapToMetricKey(rule.metric)
      if (metric) set.add(metric)
    }
  } catch (err) {
    // No D1 / storage error → treat as "no existing rules" (fail open: we may
    // suggest something already covered, which is harmless and dismissible).
    debug('[alert-suggestions] existing-rule gather failed', String(err))
  }
  return set
}

/**
 * Compute alert suggestions across every configured host for `ownerId`,
 * filtering out keys the owner has already dismissed. Memoized per owner for
 * {@link CACHE_TTL_MS}. Pass `force` to bypass the cache (e.g. right after an
 * accept/dismiss mutation invalidates it).
 */
export async function computeAlertSuggestions(
  ownerId: string,
  { force = false }: { force?: boolean } = {}
): Promise<AlertSuggestion[]> {
  const cached = cache.get(ownerId)
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value
  }

  const existing = await existingRuleMetrics(ownerId)
  const configs = getClickHouseConfigs()

  const hosts: HostSignals[] = []
  for (const config of configs) {
    const hostId = config.id
    const tables = await getExistingSystemTables(hostId)
    const [clusterShape, metricValues, baselines, recurringFindings] =
      await Promise.all([
        probeClusterShape(hostId),
        probeMetricValues(hostId, tables),
        gatherBaselines(hostId),
        gatherRecurringFindings(hostId),
      ])
    hosts.push({
      hostId,
      hostName: hostLabel(config),
      existingRuleMetrics: existing,
      clusterShape,
      metricValues,
      baselines,
      recurringFindings,
    })
  }

  const all = buildSuggestions(hosts)

  const dismissed = await listDismissedSuggestionKeys(ownerId)
  const visible = all.filter((s) => !dismissed.has(s.key))

  cache.set(ownerId, { at: Date.now(), value: visible })
  return visible
}

/** Drop the memoized compute for an owner (after accept/dismiss). */
export function invalidateAlertSuggestionsCache(ownerId: string): void {
  cache.delete(ownerId)
}
