/**
 * Map an insight finding to the explanatory chart(s) that visualize it.
 *
 * The insight detail dialog renders these charts underneath the finding so the
 * operator can see the trend behind, say, "Replication is lagging" or "26422
 * detached parts need review". The mapping is a pure function of the finding's
 * `metric` (most specific) with a `category` fallback, returning chart-registry
 * keys (see `components/charts/chart-registry`). A finding with no sensible
 * chart returns `[]` — the dialog then omits the charts section entirely rather
 * than rendering an empty/broken chart.
 *
 * Only ClickHouse charts exist in the registry, so Postgres findings (metric
 * prefixed `pg_`) intentionally map to `[]`.
 */

import type { InsightCandidate } from '@/lib/insights/types'

/** At most this many charts per finding, to keep the dialog focused. */
const MAX_CHARTS = 2

/**
 * Metric → chart keys. Keyed by the machine `metric` name emitted by the
 * collectors (`lib/insights/collectors.ts`, `operational-checks.ts`, …). The
 * chart keys here must exist in the chart registry.
 */
const METRIC_CHARTS: Record<string, readonly string[]> = {
  // Anomaly collectors
  error_rate: ['failed-query-count', 'query-count'],
  query_duration_p95: ['query-duration-percentiles', 'query-duration'],
  memory_usage: ['memory-usage'],
  insert_throughput: ['new-parts-created'],
  disk_free_pct: ['disks-usage', 'disk-size'],
  // Storage collectors
  max_active_parts: ['parts-per-table', 'merge-count'],
  detached_parts: ['parts-per-table', 'new-parts-created'],
  worst_compression_ratio: ['top-table-size', 'disk-usage-by-database'],
  // Reliability collectors
  readonly_replicas: ['readonly-replica', 'replication-summary-table'],
  max_replication_delay: [
    'replication-queue-count',
    'replication-summary-table',
  ],
  stuck_mutations: ['summary-stuck-mutations', 'merge-count'],
  failed_dictionaries: ['dictionary-count'],
  // Performance collectors
  longest_running_query: ['query-duration', 'summary-used-by-running-queries'],
}

/**
 * Category → chart keys. Used when the finding's `metric` has no specific
 * mapping (e.g. narrative-only insights, or new metrics). Coarser but never
 * wrong for the category.
 */
const CATEGORY_CHARTS: Record<string, readonly string[]> = {
  storage: ['top-table-size', 'disk-size'],
  performance: ['query-duration-percentiles', 'query-count'],
  reliability: ['failed-query-count'],
  anomaly: ['query-count'],
  queries: ['query-count', 'query-duration'],
  optimization: ['parts-per-table'],
  cost: ['disk-usage-by-database'],
}

/**
 * Resolve the explanatory chart keys for an insight finding.
 *
 * Returns up to {@link MAX_CHARTS} chart-registry keys, or `[]` when the finding
 * has no sensible chart (narrative-only, unknown category, or a Postgres `pg_*`
 * metric — the registry only has ClickHouse charts).
 */
export function insightChartNames(
  insight: Pick<InsightCandidate, 'category' | 'metric'>
): string[] {
  const metric = insight.metric?.trim()

  // Postgres findings have no ClickHouse chart to explain them.
  if (metric && metric.startsWith('pg_')) return []

  const byMetric = metric ? METRIC_CHARTS[metric] : undefined
  const charts = byMetric ?? CATEGORY_CHARTS[insight.category] ?? []
  return charts.slice(0, MAX_CHARTS)
}
