/**
 * Compact last-known PeerDB KPI snapshot.
 *
 * TanStack Query already persists successful queries (see QueryProvider), but
 * per-mirror `/mirrors/status` payloads are too large to keep on disk (hundreds
 * of QRep partitions). This store keeps only the numbers the fleet page needs
 * so the KPI row and per-row totals paint from cache on the next visit, then
 * count up to live values as probes finish.
 */

import type { MirrorMetricsSummary } from './use-mirror-metrics'

export const METRICS_CACHE_KEY_PREFIX = 'chm-peerdb-metrics-v1'
export const METRICS_CACHE_MAX_AGE_MS = 24 * 60 * 60_000
export const METRICS_CACHE_MAX_ENTRIES = 500
export const METRICS_CACHE_TREND_CAP = 48

export interface CachedMirrorMetrics extends MirrorMetricsSummary {
  source: 'cache'
}

export interface MetricsCacheSnapshot {
  v: 1
  at: number
  metrics: Record<string, MirrorMetricsSummary>
}

export function metricsCacheKey(connection: string): string {
  return `${METRICS_CACHE_KEY_PREFIX}:${connection || 'env'}`
}

function capSummary(summary: MirrorMetricsSummary): MirrorMetricsSummary {
  const trend = summary.trend.slice(-METRICS_CACHE_TREND_CAP)
  return {
    rowsPerSec: summary.rowsPerSec,
    rowsSynced: summary.rowsSynced,
    lagSec: summary.lagSec,
    trend,
  }
}

export function parseMetricsCache(
  raw: string | null
): MetricsCacheSnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<MetricsCacheSnapshot>
    if (parsed.v !== 1 || typeof parsed.at !== 'number' || !parsed.metrics) {
      return null
    }
    if (Date.now() - parsed.at > METRICS_CACHE_MAX_AGE_MS) return null
    return {
      v: 1,
      at: parsed.at,
      metrics: parsed.metrics,
    }
  } catch {
    return null
  }
}

export function readMetricsCache(
  connection: string
): MetricsCacheSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    return parseMetricsCache(
      window.localStorage.getItem(metricsCacheKey(connection))
    )
  } catch {
    return null
  }
}

export function writeMetricsCache(
  connection: string,
  metrics: Record<string, MirrorMetricsSummary>
): void {
  if (typeof window === 'undefined') return
  const entries = Object.entries(metrics).slice(0, METRICS_CACHE_MAX_ENTRIES)
  const snapshot: MetricsCacheSnapshot = {
    v: 1,
    at: Date.now(),
    metrics: Object.fromEntries(entries.map(([k, v]) => [k, capSummary(v)])),
  }
  try {
    window.localStorage.setItem(
      metricsCacheKey(connection),
      JSON.stringify(snapshot)
    )
  } catch {
    // Quota / private mode — the live query persist path still covers lists.
  }
}

/** Seed page-level totals from a snapshot, tagged so the UI can show "cached". */
export function metricsFromSnapshot(
  snapshot: MetricsCacheSnapshot | null
): Record<string, MirrorMetricsSummary> {
  if (!snapshot) return {}
  const out: Record<string, MirrorMetricsSummary> = {}
  for (const [name, summary] of Object.entries(snapshot.metrics)) {
    out[name] = { ...capSummary(summary), source: 'cache' }
  }
  return out
}
