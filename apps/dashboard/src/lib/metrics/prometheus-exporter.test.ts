import { afterEach, describe, expect, mock, test } from 'bun:test'

// ── Stub ClickHouse I/O before importing the module under test, so the
// single-flight/cache tests below never hit a real network call. ──────────
let getClientCallCount = 0

mock.module('@chm/clickhouse-client', () => ({
  getClient: async () => {
    getClientCallCount++
    return { query: async () => ({ json: async () => [] as unknown[] }) }
  },
}))

import type { ClickHouseConfig } from '@chm/clickhouse-client'

import {
  __resetPrometheusMetricsCacheForTests,
  buildPrometheusText,
  countFiringAlertsByHost,
  getPrometheusMetricsText,
  type HostMetricsInput,
  isPrometheusExporterEnabled,
} from './prometheus-exporter'
import { MemoryAlertStateStore } from '@/lib/health/alert-state-store'

// ---------------------------------------------------------------------------
// buildPrometheusText
// ---------------------------------------------------------------------------

/** Parse Prometheus text exposition format into HELP/TYPE/sample lines. */
function parsePrometheusText(text: string) {
  const lines = text.split('\n').filter((l) => l.length > 0)
  const help = new Map<string, string>()
  const type = new Map<string, string>()
  const samples: { name: string; labels: string; value: string }[] = []

  for (const line of lines) {
    if (line.startsWith('# HELP ')) {
      const [, , name, ...rest] = line.split(' ')
      help.set(name, rest.join(' '))
    } else if (line.startsWith('# TYPE ')) {
      const [, , name, kind] = line.split(' ')
      type.set(name, kind)
    } else {
      const match = line.match(
        /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)$/
      )
      expect(match).not.toBeNull()
      const [, name, labels = '', value] = match as RegExpMatchArray
      samples.push({ name, labels, value })
    }
  }

  return { lines, help, type, samples }
}

describe('buildPrometheusText', () => {
  test('emits system.metrics + asynchronous_metrics with host labels', () => {
    const inputs: HostMetricsInput[] = [
      {
        hostId: 0,
        metrics: [{ metric: 'Query', value: '42' }], // Int64 -> JSON string
        asynchronousMetrics: [
          { metric: 'AsynchronousMetricsCalculationTimeSpent', value: 0.5 }, // Float64 -> number
        ],
        alertsFiring: 2,
      },
    ]

    const text = buildPrometheusText(inputs, 0.123)
    const { help, type, samples } = parsePrometheusText(text)

    expect(help.has('clickhouse_query')).toBe(true)
    expect(type.get('clickhouse_query')).toBe('gauge')

    const querySample = samples.find((s) => s.name === 'clickhouse_query')
    expect(querySample?.labels).toBe('{host="0"}')
    expect(Number(querySample?.value)).toBe(42)

    const asyncSample = samples.find(
      (s) => s.name === 'clickhouse_asynchronousmetricscalculationtimespent'
    )
    expect(asyncSample?.labels).toBe('{host="0"}')
    expect(Number(asyncSample?.value)).toBe(0.5)
  })

  test('every sample carries a host label, including chmonitor series', () => {
    const inputs: HostMetricsInput[] = [
      { hostId: 0, metrics: [], asynchronousMetrics: [], alertsFiring: 1 },
      { hostId: 1, metrics: [], asynchronousMetrics: [], alertsFiring: 0 },
    ]

    const { samples } = parsePrometheusText(buildPrometheusText(inputs, 0.01))

    const firing = samples.filter((s) => s.name === 'chmonitor_alerts_firing')
    expect(firing).toHaveLength(2)
    expect(firing.find((s) => s.labels === '{host="0"}')?.value).toBe('1')
    expect(firing.find((s) => s.labels === '{host="1"}')?.value).toBe('0')

    // Scrape-duration is a single process-wide gauge, not per-host.
    const scrapeDuration = samples.filter(
      (s) => s.name === 'chmonitor_scrape_duration_seconds'
    )
    expect(scrapeDuration).toHaveLength(1)
    expect(scrapeDuration[0].labels).toBe('')
  })

  test('never emits chmonitor_alerts_dispatched_total (honest omission)', () => {
    const inputs: HostMetricsInput[] = [
      { hostId: 0, metrics: [], asynchronousMetrics: [], alertsFiring: 0 },
    ]
    const text = buildPrometheusText(inputs, 0.01)
    expect(text).not.toContain('chmonitor_alerts_dispatched_total')
  })

  test('HELP/TYPE lines are unique per metric name', () => {
    const inputs: HostMetricsInput[] = [
      {
        hostId: 0,
        metrics: [{ metric: 'Query', value: '1' }],
        asynchronousMetrics: [],
        alertsFiring: 0,
      },
      {
        hostId: 1,
        metrics: [{ metric: 'Query', value: '2' }],
        asynchronousMetrics: [],
        alertsFiring: 0,
      },
    ]

    const text = buildPrometheusText(inputs, 0.01)
    const helpCount = text
      .split('\n')
      .filter(
        (l) => l === '# HELP clickhouse_query ClickHouse system.metrics.Query'
      ).length
    const typeCount = text
      .split('\n')
      .filter((l) => l === '# TYPE clickhouse_query gauge').length
    expect(helpCount).toBe(1)
    expect(typeCount).toBe(1)
  })

  test('full series (name+labels) are unique across the whole output', () => {
    // Two distinct raw ClickHouse metric names that collapse to the same
    // snake_cased series name on the SAME host — must not produce two
    // identical `name{labels}` lines (Prometheus would reject that scrape).
    const inputs: HostMetricsInput[] = [
      {
        hostId: 0,
        metrics: [
          { metric: 'My.Metric', value: '1' },
          { metric: 'My-Metric', value: '2' },
        ],
        asynchronousMetrics: [],
        alertsFiring: 0,
      },
    ]

    const text = buildPrometheusText(inputs, 0.01)
    const sampleLines = text.split('\n').filter((l) => l && !l.startsWith('#'))
    const seriesKeys = sampleLines.map((l) => l.split(' ')[0])
    expect(new Set(seriesKeys).size).toBe(seriesKeys.length)
  })

  test('skips non-finite / unparsable values instead of emitting garbage', () => {
    const inputs: HostMetricsInput[] = [
      {
        hostId: 0,
        metrics: [
          { metric: 'Good', value: '10' },
          { metric: 'Bad', value: 'not-a-number' },
        ],
        asynchronousMetrics: [],
        alertsFiring: 0,
      },
    ]

    const text = buildPrometheusText(inputs, 0.01)
    expect(text).toContain('clickhouse_good')
    expect(text).not.toContain('clickhouse_bad')
  })

  test('null metrics/asynchronousMetrics (failed host query) are treated as empty, not fatal', () => {
    const inputs: HostMetricsInput[] = [
      { hostId: 0, metrics: null, asynchronousMetrics: null, alertsFiring: 0 },
    ]

    const text = buildPrometheusText(inputs, 0.01)
    // Still emits the process-wide + per-host gauges even with zero CH data.
    expect(text).toContain('chmonitor_scrape_duration_seconds')
    expect(text).toContain('chmonitor_alerts_firing{host="0"} 0')
  })

  test('all sample values are numeric', () => {
    const inputs: HostMetricsInput[] = [
      {
        hostId: 0,
        metrics: [{ metric: 'Query', value: '42' }],
        asynchronousMetrics: [{ metric: 'Uptime', value: 99.5 }],
        alertsFiring: 3,
      },
    ]
    const { samples } = parsePrometheusText(buildPrometheusText(inputs, 0.5))
    for (const sample of samples) {
      expect(Number.isFinite(Number(sample.value))).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// countFiringAlertsByHost
// ---------------------------------------------------------------------------

describe('countFiringAlertsByHost', () => {
  test('groups firing conditions by host id, ignoring ok records', () => {
    const store = new MemoryAlertStateStore()
    store.set('0:disk-usage', {
      severity: 'critical',
      updatedAt: 1,
      notifiedAt: 1,
    })
    store.set('0:cpu-usage', {
      severity: 'warning',
      updatedAt: 1,
      notifiedAt: 1,
    })
    store.set('1:disk-usage', {
      severity: 'warning',
      updatedAt: 1,
      notifiedAt: 1,
    })
    // Defensive: an 'ok' record should never really be persisted, but the
    // count must still exclude it if one somehow is.
    store.set('2:stray-ok', { severity: 'ok', updatedAt: 1, notifiedAt: 1 })

    const counts = countFiringAlertsByHost(store)
    expect(counts.get(0)).toBe(2)
    expect(counts.get(1)).toBe(1)
    expect(counts.has(2)).toBe(false)
  })

  test('empty store yields an empty map', () => {
    const store = new MemoryAlertStateStore()
    expect(countFiringAlertsByHost(store).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// isPrometheusExporterEnabled — fail-open self-host default, opt-in cloud.
// ---------------------------------------------------------------------------

describe('isPrometheusExporterEnabled', () => {
  test('self-hosted default (no cloud mode) → enabled', () => {
    expect(isPrometheusExporterEnabled({})).toBe(true)
  })

  test('cloud mode default (no explicit flag) → disabled', () => {
    expect(isPrometheusExporterEnabled({ CHM_CLOUD_MODE: 'true' })).toBe(false)
  })

  test('explicit flag wins over self-hosted default', () => {
    expect(
      isPrometheusExporterEnabled({ CHM_FEATURE_PROMETHEUS_ENABLED: 'false' })
    ).toBe(false)
  })

  test('explicit flag wins over cloud default (opt-in)', () => {
    expect(
      isPrometheusExporterEnabled({
        CHM_CLOUD_MODE: 'true',
        CHM_FEATURE_PROMETHEUS_ENABLED: 'true',
      })
    ).toBe(true)
  })

  test('never gates on billing/plan — only cloud-mode + explicit flag inputs', () => {
    // No plan/entitlement fields are read at all; passing unrelated keys must
    // not change the outcome (fail-open, no billing dependency).
    expect(isPrometheusExporterEnabled({ SOME_UNRELATED_VAR: 'x' })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getPrometheusMetricsText — 30s cache + single-flight rebuild.
// ---------------------------------------------------------------------------

describe('getPrometheusMetricsText', () => {
  afterEach(() => {
    __resetPrometheusMetricsCacheForTests()
    getClientCallCount = 0
  })

  const configs: ClickHouseConfig[] = [
    { id: 0, host: 'http://localhost:8123', user: 'default', password: '' },
  ]

  test('concurrent scrapes share one in-flight build (single query batch)', async () => {
    // Two calls fired back-to-back, neither awaited before the other starts —
    // exactly what a scrape storm looks like. If each triggered its own
    // rebuild, getClient would be called 4 times (2 queries x 2 builds)
    // instead of 2 (2 queries x 1 build).
    const [a, b] = await Promise.all([
      getPrometheusMetricsText(configs),
      getPrometheusMetricsText(configs),
    ])

    expect(a).toBe(b)
    expect(getClientCallCount).toBe(2)
  })

  test('a call within the 30s cache TTL reuses the cached body (no new queries)', async () => {
    await getPrometheusMetricsText(configs)
    expect(getClientCallCount).toBe(2)

    await getPrometheusMetricsText(configs)
    // Still within the TTL — zero additional ClickHouse queries.
    expect(getClientCallCount).toBe(2)
  })
})
