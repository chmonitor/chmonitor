/**
 * Static, deterministic mock insights for the settings "Example" preview.
 *
 * The settings page shows an example of what AI Insights look like. Calling the
 * real generation endpoint there is a poor fit: it needs a reachable, writable
 * cluster and a configured LLM, so anonymous visitors (and read-only demo hosts)
 * only ever saw "Couldn't generate — the cluster may be unreachable or
 * read-only." These mock cards let the example always render, with NO network or
 * LLM call, while still reflecting the operator's current settings so the page
 * stays a useful sandbox for A/B-ing prompt style / enrichment.
 *
 * This is illustrative sample data, never real cluster analysis — the preview UI
 * labels it as such.
 */

import type { InsightsSettings } from './settings'

import { type InsightCard, insightKey } from './types'

interface MockTemplate {
  readonly severity: InsightCard['severity']
  readonly category: string
  readonly metric: string
  readonly value: number
  readonly title: string
  /** Copy variants keyed by prompt style; `deterministic` is the un-enriched form. */
  readonly detail: Record<
    InsightsSettings['promptStyle'] | 'deterministic',
    string
  >
  readonly action?: InsightCard['action']
}

/** Human label for the read window, e.g. `6 HOUR` → "the last 6 hours". */
function windowPhrase(window: string): string {
  const [n, unit] = window.split(' ')
  const lower = (unit ?? '').toLowerCase()
  const plural = n === '1' ? lower : `${lower}s`
  return `the last ${n} ${plural}`
}

const TEMPLATES: readonly MockTemplate[] = [
  {
    severity: 'warning',
    category: 'performance',
    metric: 'slow_query_p99',
    value: 4200,
    title: 'p99 query latency climbing',
    detail: {
      deterministic: 'p99 query duration is 4.2s (baseline 1.8s).',
      concise:
        'p99 query latency reached 4.2s, ~2.3× the 1.8s baseline — a handful of large scans on `events` are dominating.',
      detailed:
        'p99 query duration rose to 4.2s over {window}, about 2.3× the 1.8s weekly baseline. The regression traces to a few full scans on `events` that read ~9.4B rows each; adding a partition filter or a projection on `event_date` would cut the read set sharply.',
      beginner:
        'The slowest 1% of queries now take about 4.2 seconds — more than double the usual 1.8 seconds. This is because some queries read the whole `events` table instead of just the days they need. Filtering by date, or adding a projection, lets ClickHouse skip most of the data.',
    },
    action: { label: 'View slow queries', href: '/queries/insights' },
  },
  {
    severity: 'critical',
    category: 'storage',
    metric: 'disk_free_pct',
    value: 8,
    title: 'Disk nearly full on one node',
    detail: {
      deterministic: 'Free disk on `default` is 8% (below 15% threshold).',
      concise:
        'Free disk dropped to 8% on the `default` disk — parts for `logs` grew 40% this week. TTL or a move-to-cold policy will reclaim space.',
      detailed:
        'The `default` disk is at 8% free, under the 15% warning threshold, after `logs` parts grew ~40% over {window}. At the current ingest rate the node has roughly 3 days of headroom; a TTL on `logs.event_date` or a tiered storage move policy would reclaim space before it becomes an incident.',
      beginner:
        'One node is almost out of disk space — only 8% is free. The `logs` table has been growing quickly. Setting a TTL (an automatic expiry on old rows) or moving old data to cheaper storage will free space and prevent an outage.',
    },
    action: { label: 'View storage', href: '/tables-overview' },
  },
  {
    severity: 'info',
    category: 'reliability',
    metric: 'error_rate',
    value: 0.3,
    title: 'Error rate stable and low',
    detail: {
      deterministic: 'Query error rate is 0.3% over the window.',
      concise:
        'Error rate held at 0.3% across {window} — no new exception signatures, nothing to action.',
      detailed:
        'The query error rate stayed at 0.3% over {window}, in line with the trailing baseline. No new exception signatures appeared and the top error (`MEMORY_LIMIT_EXCEEDED`, 11 events) is unchanged from last week — informational only.',
      beginner:
        'Very few queries are failing — about 0.3%, which is normal and healthy. No new kinds of errors showed up, so there is nothing to fix here.',
    },
  },
  {
    severity: 'warning',
    category: 'anomaly',
    metric: 'insert_throughput',
    value: -37,
    title: 'Insert throughput dip detected',
    detail: {
      deterministic: 'Insert rows/s is 37% below the moving average.',
      concise:
        'Insert throughput fell 37% below its moving average during {window} — likely backpressure from merges on `metrics`.',
      detailed:
        'Insert throughput dipped to 37% below the 7-point moving average over {window}, crossing the anomaly band. It correlates with a merge backlog on `metrics` (parts count rose to 380); the dip should recover as merges drain, but sustained backpressure would warrant raising `background_pool_size`.',
      beginner:
        'Data is being inserted more slowly than usual — about 37% below the typical rate. This often happens when ClickHouse is busy merging table parts in the background. It usually recovers on its own once the merges finish.',
    },
    action: { label: 'View merges', href: '/merges' },
  },
]

/**
 * Build a deterministic set of example insight cards for the given settings.
 *
 * `seed` (a monotonically increasing reroll counter from the UI) rotates which
 * subset of templates is shown so "Regenerate" visibly changes the example
 * without any randomness that would break SSR / snapshots.
 */
export function buildMockInsights(
  hostId: number,
  settings: InsightsSettings,
  seed = 0
): InsightCard[] {
  const phrase = windowPhrase(settings.window)
  // Rotate the template order by the seed, then take three cards.
  const count = 3
  const rotated = TEMPLATES.map(
    (_, i) => TEMPLATES[(i + seed) % TEMPLATES.length]
  ).slice(0, count)

  return rotated.map((t) => {
    const raw = settings.enrich
      ? t.detail[settings.promptStyle]
      : t.detail.deterministic
    const detail = raw.replaceAll('{window}', phrase)
    return {
      severity: t.severity,
      category: t.category,
      title: t.title,
      detail,
      metric: t.metric,
      value: t.value,
      action: t.action,
      key: insightKey(hostId, t),
      generatedAt: undefined,
    }
  })
}
