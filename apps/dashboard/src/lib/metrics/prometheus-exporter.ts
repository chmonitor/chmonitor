/**
 * Prometheus metrics exporter.
 *
 * Serves `system.metrics` + `system.asynchronous_metrics` from every
 * configured ClickHouse host, plus chmonitor's own alert-firing gauge, as
 * Prometheus text exposition format. Backs `GET /api/v1/metrics` (see
 * `routes/api/v1/metrics.ts`).
 *
 * Design:
 * - Reads go through `@chm/clickhouse-client` (`getClient`), the same
 *   DNS-pinned/SSRF-guarded per-host transport every other CH-querying route
 *   uses. No new outbound fetch surface.
 * - Per-host queries are best-effort: a failing host is skipped, never fails
 *   the whole scrape (mirrors `notifications.ts`'s fan-out).
 * - Honest series only: `chmonitor_alerts_dispatched_total` is intentionally
 *   NOT emitted — no server-side persistence tracks a running dispatch total
 *   (the client-side history ring buffer in `history-storage.ts` is
 *   localStorage-only and invisible to the Worker). Fabricating a counter
 *   would violate the "no fabricated series" invariant, so it's omitted.
 * - Cached for 30s with single-flight rebuild so a scrape storm triggers one
 *   query batch, not one per concurrent scraper.
 */

import type { ClickHouseConfig } from '@chm/clickhouse-client'
import type { AlertStateStore } from '@/lib/health/alert-state-store'

import { getClient } from '@chm/clickhouse-client'
import { error as logError } from '@chm/logger'
import { isCloudModeServer } from '@/lib/cloud/cloud-mode'
import { alertStateStore } from '@/lib/health/alert-state-store'

const CACHE_TTL_MS = 30_000

const METRICS_QUERY = 'SELECT metric, value FROM system.metrics'
const ASYNC_METRICS_QUERY =
  'SELECT metric, value FROM system.asynchronous_metrics'

/** One row as returned by ClickHouse (JSONEachRow). */
export interface RawMetricRow {
  metric: string
  /** Int64 columns (system.metrics) serialize as strings; Float64 as numbers. */
  value: string | number
}

/** Per-host inputs to the text builder. `null` marks a failed/skipped query. */
export interface HostMetricsInput {
  /** Stable numeric host id — NEVER the raw host string (may carry creds). */
  hostId: number
  metrics: RawMetricRow[] | null
  asynchronousMetrics: RawMetricRow[] | null
  /** Currently-firing alert count for this host, from the in-memory alert state. */
  alertsFiring: number
}

// ---------------------------------------------------------------------------
// Pure text building (unit-tested directly — no ClickHouse/env dependency).
// ---------------------------------------------------------------------------

interface MetricFamily {
  help: string
  type: 'gauge'
  /** seriesKey (labels string) -> full sample line. Last write wins on collision. */
  samples: Map<string, string>
}

/** `Query` / `jemalloc.metadata` -> `clickhouse_query` / `clickhouse_jemalloc_metadata`. */
function toMetricName(rawMetric: string): string {
  const snake = rawMetric.toLowerCase().replace(/[^a-z0-9_]+/g, '_')
  return `clickhouse_${snake}`
}

/** Escape a label value per the Prometheus text exposition format rules. */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels)
  if (entries.length === 0) return ''
  const parts = entries.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
  return `{${parts.join(',')}}`
}

function toFiniteNumber(value: string | number): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function addSample(
  families: Map<string, MetricFamily>,
  name: string,
  help: string,
  labels: Record<string, string>,
  value: number
): void {
  let family = families.get(name)
  if (!family) {
    family = { help, type: 'gauge', samples: new Map() }
    families.set(name, family)
  }
  const labelStr = formatLabels(labels)
  // Keyed by labels alone (name is already the map key) so two source metrics
  // that collapse to the same name+labels never emit an invalid duplicate
  // series — last write wins rather than producing unparsable output.
  family.samples.set(labelStr, `${name}${labelStr} ${value}`)
}

/**
 * Build the full Prometheus text body from per-host inputs. Pure — no I/O.
 */
export function buildPrometheusText(
  inputs: readonly HostMetricsInput[],
  scrapeDurationSeconds: number
): string {
  const families = new Map<string, MetricFamily>()

  for (const input of inputs) {
    const labels = { host: String(input.hostId) }

    for (const row of input.metrics ?? []) {
      const value = toFiniteNumber(row.value)
      if (value === null) continue
      addSample(
        families,
        toMetricName(row.metric),
        `ClickHouse system.metrics.${row.metric}`,
        labels,
        value
      )
    }

    for (const row of input.asynchronousMetrics ?? []) {
      const value = toFiniteNumber(row.value)
      if (value === null) continue
      addSample(
        families,
        toMetricName(row.metric),
        `ClickHouse system.asynchronous_metrics.${row.metric}`,
        labels,
        value
      )
    }

    addSample(
      families,
      'chmonitor_alerts_firing',
      'Number of chmonitor alert conditions currently firing (warning or critical) for this host.',
      labels,
      input.alertsFiring
    )
  }

  addSample(
    families,
    'chmonitor_scrape_duration_seconds',
    'Time taken to build this chmonitor /metrics scrape, in seconds.',
    {},
    scrapeDurationSeconds
  )

  const lines: string[] = []
  for (const [name, family] of families) {
    lines.push(`# HELP ${name} ${family.help}`)
    lines.push(`# TYPE ${name} ${family.type}`)
    for (const sample of family.samples.values()) {
      lines.push(sample)
    }
  }
  return `${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// Alert-firing counts from the in-memory alert-state store.
// ---------------------------------------------------------------------------

/**
 * Count currently-firing conditions (any severity above `ok`) per host from
 * the alert dedup state. Every record the store holds already represents a
 * firing (non-ok) condition — recoveries delete their entry — so this is a
 * plain group-count over `entries()`.
 *
 * Caveat: `alertStateStore` is an in-memory, per-isolate singleton. On Node
 * (Docker/K8s self-host) the sweep and this exporter share the same process,
 * so counts are accurate. On Workerd, the isolate serving a scrape may differ
 * from the isolate that last ran the cron sweep, in which case this reads 0 —
 * a freshness gap, not a fabricated value. A cross-isolate store would need a
 * new persistence layer, which is out of scope (see plan STOP conditions).
 */
export function countFiringAlertsByHost(
  store: AlertStateStore
): Map<number, number> {
  const counts = new Map<number, number>()
  for (const [key, record] of store.entries()) {
    if (record.severity === 'ok') continue // defensive; store never persists 'ok'
    const hostId = Number(key.split(':')[0])
    if (!Number.isInteger(hostId)) continue
    counts.set(hostId, (counts.get(hostId) ?? 0) + 1)
  }
  return counts
}

// ---------------------------------------------------------------------------
// Feature gate.
// ---------------------------------------------------------------------------

function parseBoolEnv(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

/**
 * Prometheus exporter feature gate. `CHM_FEATURE_PROMETHEUS_ENABLED` always
 * wins when set; otherwise defaults ON for self-hosted deployments and OFF in
 * cloud mode. Fail-open: resolves purely from cloud-mode detection, never a
 * billing/plan check, so a Clerk-less OSS instance always gets it on by
 * default.
 */
export function isPrometheusExporterEnabled(
  bindings: Record<string, string | undefined>
): boolean {
  const explicit = parseBoolEnv(bindings.CHM_FEATURE_PROMETHEUS_ENABLED)
  if (explicit !== undefined) return explicit
  return !isCloudModeServer(bindings)
}

// ---------------------------------------------------------------------------
// ClickHouse querying + 30s single-flight cache.
// ---------------------------------------------------------------------------

async function queryHostRows(
  clientConfig: ClickHouseConfig,
  query: string
): Promise<RawMetricRow[] | null> {
  try {
    const client = await getClient({ web: true, clientConfig })
    const resultSet = await client.query({ query, format: 'JSONEachRow' })
    return await resultSet.json<RawMetricRow>()
  } catch (err) {
    logError('[metrics] host metric query failed', err, {
      hostId: clientConfig.id,
    })
    return null
  }
}

async function collectHostMetrics(
  clientConfig: ClickHouseConfig,
  alertCounts: Map<number, number>
): Promise<HostMetricsInput> {
  const [metrics, asynchronousMetrics] = await Promise.all([
    queryHostRows(clientConfig, METRICS_QUERY),
    queryHostRows(clientConfig, ASYNC_METRICS_QUERY),
  ])

  return {
    hostId: clientConfig.id,
    metrics,
    asynchronousMetrics,
    alertsFiring: alertCounts.get(clientConfig.id) ?? 0,
  }
}

async function buildScrape(
  configs: readonly ClickHouseConfig[]
): Promise<string> {
  const startedAt = Date.now()
  const alertCounts = countFiringAlertsByHost(alertStateStore)
  const perHost = await Promise.all(
    configs.map((config) => collectHostMetrics(config, alertCounts))
  )
  const scrapeDurationSeconds = (Date.now() - startedAt) / 1000
  return buildPrometheusText(perHost, scrapeDurationSeconds)
}

interface CacheEntry {
  builtAt: number
  body: string
}

let cache: CacheEntry | null = null
let inFlight: Promise<string> | null = null

/**
 * Cached (~30s) Prometheus scrape body for the given host configs. Concurrent
 * calls during a rebuild share the same in-flight promise, so a scrape storm
 * triggers exactly one query batch.
 */
export async function getPrometheusMetricsText(
  configs: readonly ClickHouseConfig[]
): Promise<string> {
  if (cache && Date.now() - cache.builtAt < CACHE_TTL_MS) {
    return cache.body
  }

  if (!inFlight) {
    inFlight = buildScrape(configs)
      .then((body) => {
        cache = { builtAt: Date.now(), body }
        return body
      })
      .finally(() => {
        inFlight = null
      })
  }

  return inFlight
}

/** Test-only: reset module-level cache/in-flight state between test cases. */
export function __resetPrometheusMetricsCacheForTests(): void {
  cache = null
  inFlight = null
}
