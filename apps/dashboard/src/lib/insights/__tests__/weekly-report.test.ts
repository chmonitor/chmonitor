/**
 * Weekly health report tests.
 *
 * Covers the three things the plan calls out: (1) `buildWeeklyReport` assembles
 * a correct structured summary from fixture findings + baselines + capacity;
 * (2) an undelivered report is still persisted (fail-open, no delivery channel);
 * (3) `renderWeeklyReportHtml` emits valid, fully self-contained markup (no
 * external assets) with the key sections and the honesty disclaimer, and
 * escapes untrusted finding text.
 *
 * I/O boundaries are mocked so the test is hermetic: the capacity forecaster
 * (ClickHouse) and the D1-backed weekly-report store are stubbed, while the
 * findings come through the real pluggable insights store on its in-memory
 * backend. mock.module calls precede the imports of the module under test so the
 * stubs are registered before its module graph loads (same pattern as
 * read-insights.store.test.ts).
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

// Stub the virtual Worker env touched transitively via @chm/clickhouse-client.
mock.module('cloudflare:workers', () => ({ env: {} }))

// Stub the capacity forecaster (ClickHouse I/O) with a deterministic forecast.
const FIXTURE_FORECAST = {
  available: true as const,
  hostId: 0,
  horizonDays: 90,
  sampleDays: 30,
  dailyGrowthBytes: 5_000_000_000,
  readableDailyGrowth: '4.66 GB',
  daysToFull: 42,
  fullDate: '2026-08-15T00:00:00.000Z',
  willExceedHorizon: false,
  confidence: 'high' as const,
  freeBytes: 210_000_000_000,
  totalBytes: 1_000_000_000_000,
  topContributors: [],
  caveat: 'Linear projection from 30 days of history.',
  explanation:
    'At the current write rate the disk fills in ~42 days. This is a projection, not a guarantee.',
}
mock.module('@/lib/ai/advisor/capacity-forecaster', () => ({
  forecastDiskFull: async () => FIXTURE_FORECAST,
}))

// Stub the baseline store so baselinesFitted is deterministic.
mock.module('../baseline-store', () => ({
  listBaselines: async () => [{ metric: 'error_rate' }, { metric: 'qps' }],
}))

// Capture persistence in memory instead of hitting D1.
const persisted: Array<{
  weekStart: string
  delivered: boolean
  html: string
}> = []
mock.module('../weekly-report-store', () => ({
  persistWeeklyReport: async (record: {
    weekStart: string
    delivered: boolean
    html: string
  }) => {
    persisted.push({
      weekStart: record.weekStart,
      delivered: record.delivered,
      html: record.html,
    })
    return true
  },
}))

// Dynamic imports AFTER the mock.module calls above: static imports hoist above
// mock.module, so the module-under-test's graph (which transitively imports the
// virtual `cloudflare:workers` module via platform-native) must be loaded lazily
// for the stubs to take effect. Mirrors retention-owner.test.ts.
const {
  buildFleetMarkdown,
  buildWeeklyReport,
  parseOptedInHosts,
  runWeeklyReportForHost,
} = await import('../weekly-report')
const { renderWeeklyReportHtml } = await import('../weekly-report-html')
const { resetInsightsStoreCache, resolveInsightsStore } = await import(
  '../store/resolve-store'
)

const savedBackend = process.env.INSIGHTS_STORE_BACKEND
const savedWebhook = process.env.HEALTH_ALERT_WEBHOOK_URL

beforeEach(async () => {
  process.env.INSIGHTS_STORE_BACKEND = 'memory'
  delete process.env.HEALTH_ALERT_WEBHOOK_URL
  resetInsightsStoreCache()
  persisted.length = 0

  const store = await resolveInsightsStore()
  await store.record(0, [
    {
      severity: 'critical',
      category: 'reliability',
      source: 'ai-insight',
      title: 'replication queue backing up',
      detail: 'replica is 1200 parts behind',
      metric: 'replication_lag',
      value: 1200,
    },
    {
      severity: 'warning',
      category: 'storage',
      source: 'ai-insight',
      title: 'table events is fragmented',
      detail: 'active parts above baseline',
      metric: 'max_active_parts',
      value: 318,
    },
    {
      severity: 'info',
      category: 'performance',
      source: 'ai-insight',
      title: 'query latency nominal',
      detail: 'p99 within baseline',
      metric: 'p99_latency',
      value: 120,
    },
  ])
})

afterAll(() => {
  if (savedBackend === undefined) delete process.env.INSIGHTS_STORE_BACKEND
  else process.env.INSIGHTS_STORE_BACKEND = savedBackend
  if (savedWebhook === undefined) delete process.env.HEALTH_ALERT_WEBHOOK_URL
  else process.env.HEALTH_ALERT_WEBHOOK_URL = savedWebhook
  resetInsightsStoreCache()
})

describe('buildWeeklyReport', () => {
  test('assembles a structured summary from findings + baselines + capacity', async () => {
    const { summary, markdown, html } = await buildWeeklyReport(0, 'prod-eu')

    expect(summary.hostId).toBe(0)
    expect(summary.hostLabel).toBe('prod-eu')
    expect(summary.totalFindings).toBe(3)
    expect(summary.bySeverity).toEqual({ critical: 1, warning: 1, info: 1 })
    expect(summary.byCategory).toEqual({
      reliability: 1,
      storage: 1,
      performance: 1,
    })

    // Top findings ranked by severity (critical first).
    expect(summary.topFindings[0]).toMatchObject({
      severity: 'critical',
      title: 'replication queue backing up',
    })

    // Baselines folded in (plan 48) + capacity forecast (plan 50).
    expect(summary.baselinesFitted).toBe(2)
    expect(summary.capacity).toMatchObject({ available: true, daysToFull: 42 })

    expect(markdown).toContain('Weekly Health Report — prod-eu')
    expect(html).toContain('<!doctype html>')
  })
})

describe('runWeeklyReportForHost', () => {
  test('persists the report even when no delivery channel is configured', async () => {
    const result = await runWeeklyReportForHost(0, 'prod-eu')

    expect(result.channelConfigured).toBe(false)
    expect(result.delivered).toBe(false)
    expect(result.persisted).toBe(true)

    // Persisted exactly once, undelivered, with rendered HTML.
    expect(persisted).toHaveLength(1)
    expect(persisted[0].delivered).toBe(false)
    expect(persisted[0].html).toContain('<!doctype html>')
  })
})

describe('renderWeeklyReportHtml', () => {
  test('produces valid, fully self-contained markup with the key sections', async () => {
    const { summary } = await buildWeeklyReport(0, 'prod-eu')
    const html = renderWeeklyReportHtml(summary)

    // Self-contained: no external asset requests at all.
    expect(html).not.toMatch(/<link\b/i)
    expect(html).not.toMatch(/<script\b/i)
    expect(html).not.toMatch(/src\s*=\s*["']https?:/i)
    expect(html).not.toMatch(/@import/i)

    // Structure + key sections.
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<style>')
    expect(html).toContain('Top findings')
    expect(html).toContain('Capacity outlook')
    expect(html).toContain('Findings by category')

    // Honesty invariant surfaced in the narrative.
    expect(html).toContain('nothing here was applied automatically')

    // Dark-mode aware + product OKLCH tokens.
    expect(html).toContain('prefers-color-scheme: dark')
    expect(html).toContain('oklch(')
  })

  test('escapes untrusted finding text to prevent markup injection', () => {
    const html = renderWeeklyReportHtml({
      hostId: 0,
      hostLabel: 'prod',
      weekStart: '2026-06-27',
      weekEnd: '2026-07-04',
      generatedAt: '2026-07-04T08:00:00.000Z',
      totalFindings: 1,
      bySeverity: { critical: 1, warning: 0, info: 0 },
      byCategory: { reliability: 1 },
      topFindings: [
        {
          severity: 'critical',
          category: 'reliability',
          title: '<script>alert(1)</script>',
          detail: 'x & y < z',
          metric: 'm',
          generatedAt: '2026-07-04T08:00:00.000Z',
        },
      ],
      baselinesFitted: 0,
      capacity: {
        available: false,
        reason: 'error',
        message: 'no forecast',
      },
    })

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('x &amp; y &lt; z')
  })
})

describe('buildFleetMarkdown', () => {
  test('combines per-host summaries into one digest with a fleet overview', async () => {
    const { summary } = await buildWeeklyReport(0, 'prod-eu')
    const second = { ...summary, hostId: 1, hostLabel: 'staging-us' }
    const md = buildFleetMarkdown([summary, second], 'weekly')

    expect(md).toContain('Weekly Health Report — 2 hosts')
    expect(md).toContain('## Fleet overview')
    expect(md).toContain('**prod-eu**')
    expect(md).toContain('**staging-us**')
    // Per-host top-finding highlight lines.
    expect(md).toContain('replication queue backing up')
  })
})

describe('parseOptedInHosts', () => {
  test('parses, de-dupes, sorts, and drops garbage; empty by default', () => {
    expect(parseOptedInHosts(undefined)).toEqual([])
    expect(parseOptedInHosts('')).toEqual([])
    expect(parseOptedInHosts('2, 0, 2, x, -1, 1')).toEqual([0, 1, 2])
  })
})
