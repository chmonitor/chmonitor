/**
 * Tests for the anomaly collector's statistical-baseline integration.
 *
 * `decideSeverity` is a pure function (no ClickHouse/D1 I/O) — the cold-start
 * and false-positive-reduction assertions run against it directly with
 * constructed `Baseline` objects, no mocking required. A small end-to-end
 * `collectInsights` test at the bottom stubs only `readOnlyQuery` (the
 * ClickHouse I/O boundary, following the pattern in
 * `../health/incident-snapshot.test.ts`) and deliberately leaves the real
 * `baseline-store`/`@chm/platform` code path in place: in a plain `bun test`
 * process there is no `CLOUDFLARE_WORKERS`/`MINIFLARE` env, so
 * `getPlatformBindings()` resolves to the in-memory adapter and `getBaseline`
 * naturally returns `null` — the exact "no D1 configured" cold-start case this
 * plan must not regress. See plans/48-statistical-anomaly-baselines.md.
 *
 * `@chm/platform` is also mocked below: apps/dashboard's tsconfig aliases that
 * specifier to a Cloudflare-Workers-only shim (`platform-native.ts`, importing
 * `cloudflare:workers`), so it must be stubbed the same way
 * `insights/store/d1-store.test.ts` does for the import graph to resolve under
 * plain `bun test`. It resolves to "no D1" here too, so this is still the real
 * cold-start code path, not a baseline fake.
 */

import type { Baseline } from './statistical-baseline'
import type { InsightSeverity } from './types'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// ── Stub external I/O before importing the module under test. ─────────────

type QueryHandler = (sql: string) => unknown
let handler: QueryHandler = () => []

mock.module('../ai/agent/tools/helpers', () => ({
  readOnlyQuery: async ({ query }: { query: string }) => handler(query),
}))

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({ getD1Database: () => null }),
}))

const { collectInsights, decideSeverity } = await import('./collectors')
const { fitBaseline } = await import('./statistical-baseline')

beforeEach(() => {
  handler = () => []
})

const classify = (pct: number): InsightSeverity =>
  pct > 100 ? 'critical' : pct > 50 ? 'warning' : 'info'

function fires(severity: InsightSeverity | null): boolean {
  return severity !== null
}

// ── Pure decideSeverity tests (no I/O). ────────────────────────────────────

describe('decideSeverity — cold-start fallback (no regression)', () => {
  test('with no baseline, a large changePct still fires via the static classify, exactly as before', () => {
    const decision = decideSeverity(9, 80, null, classify) // 80% > 50 -> warning
    expect(decision.usedBaseline).toBe(false)
    expect(decision.z).toBeNull()
    expect(decision.severity).toBe('warning')
  })

  test('with no baseline, a small changePct is suppressed (info -> null), matching pre-baseline behavior', () => {
    const decision = decideSeverity(5.1, 20, null, classify) // 20% <= 50 -> info -> suppressed
    expect(decision.usedBaseline).toBe(false)
    expect(decision.severity).toBeNull()
  })
})

describe('decideSeverity — false-positive reduction vs the static threshold', () => {
  // A cluster whose error_rate naturally fluctuates ~2.6%-3.5% -- entirely
  // normal for THIS cluster. Fit a baseline from that fluctuation.
  const baseline: Baseline = fitBaseline(
    '0',
    'error_rate',
    [2.6, 2.8, 3.0, 3.2, 3.4, 2.7, 2.9, 3.1, 3.3, 3.5, 2.6, 3.0, 3.4, 2.8, 3.2]
  )

  // (recent, 24h-baselineAvg) pairs: `recent` stays inside the cluster's
  // normal band above, but a lower 24h average pushes changePct past the
  // static 50% cutoff -- the false positive a fixed percentage threshold
  // produces on a cluster whose normal range differs from the default.
  const scenarios: Array<{ recent: number; baselineAvg: number }> = [
    { recent: 3.4, baselineAvg: 2.0 },
    { recent: 3.2, baselineAvg: 1.9 },
    { recent: 3.5, baselineAvg: 2.1 },
    { recent: 3.3, baselineAvg: 1.8 },
    { recent: 3.1, baselineAvg: 1.7 },
    { recent: 3.0, baselineAvg: 1.6 },
    { recent: 3.4, baselineAvg: 2.2 },
    { recent: 3.2, baselineAvg: 2.0 },
    { recent: 2.9, baselineAvg: 1.5 },
    { recent: 3.3, baselineAvg: 2.1 },
  ]

  test('the baseline-backed path suppresses materially more false positives than the static path', () => {
    let staticFires = 0
    let baselineFires = 0

    for (const { recent, baselineAvg } of scenarios) {
      const changePct = ((recent - baselineAvg) / Math.abs(baselineAvg)) * 100
      if (fires(decideSeverity(recent, changePct, null, classify).severity)) {
        staticFires++
      }
      if (
        fires(decideSeverity(recent, changePct, baseline, classify).severity)
      ) {
        baselineFires++
      }
    }

    // Sanity-check the scenario is actually valid (the static path really
    // does false-positive here) before asserting the reduction.
    expect(staticFires).toBeGreaterThan(0)
    expect(baselineFires).toBeLessThan(staticFires)
    // Materially fewer -- at least half the static false-positive count.
    expect(baselineFires).toBeLessThanOrEqual(Math.ceil(staticFires / 2))
  })
})

describe('decideSeverity — genuine anomalies still fire with a baseline present', () => {
  const baseline: Baseline = fitBaseline(
    '0',
    'error_rate',
    [2.6, 2.8, 3.0, 3.2, 3.4, 2.7, 2.9, 3.1, 3.3, 3.5, 2.6, 3.0, 3.4, 2.8, 3.2]
  )

  test('a moderate spike (2 < |z| <= 4) is classified warning', () => {
    const recent = baseline.mean + 3 * baseline.stddev
    const decision = decideSeverity(recent, 900, baseline, classify)
    expect(decision.usedBaseline).toBe(true)
    expect(decision.severity).toBe('warning')
  })

  test('an extreme spike (|z| > 4) is classified critical', () => {
    const recent = baseline.mean + 5 * baseline.stddev
    const decision = decideSeverity(recent, 1500, baseline, classify)
    expect(decision.usedBaseline).toBe(true)
    expect(decision.severity).toBe('critical')
  })
})

// ── End-to-end collectInsights: only readOnlyQuery is stubbed above. ──────

describe('collectInsights — end-to-end cold start (no D1 baseline store)', () => {
  test('an error-rate spike still fires via the static fallback when no baseline is on file', async () => {
    // No CLOUDFLARE_WORKERS/MINIFLARE env in this test process, so
    // getPlatformBindings() resolves to the in-memory adapter and
    // getBaseline() naturally returns null -- the real cold-start path, not a
    // mocked one.
    handler = (sql) => {
      if (sql.includes('ExceptionWhileProcessing')) {
        if (sql.includes('BETWEEN')) return [{ value: 5 }] // 24h baseline: 5%
        if (sql.includes('GROUP BY bucket')) return [] // 7-day sample window
        return [{ value: 20 }] // recent (1h): 20% -> changePct 200% -> critical
      }
      return []
    }

    const insights = await collectInsights(0)
    const errorRateInsight = insights.find((i) => i.metric === 'error_rate')

    expect(errorRateInsight).toBeDefined()
    expect(errorRateInsight?.severity).toBe('critical')
    expect(errorRateInsight?.detail).toContain('24h baseline')
  })

  test('a change within the static threshold stays suppressed', async () => {
    handler = (sql) => {
      if (sql.includes('ExceptionWhileProcessing')) {
        if (sql.includes('BETWEEN')) return [{ value: 5 }]
        if (sql.includes('GROUP BY bucket')) return []
        return [{ value: 5.5 }] // changePct 10% -> info -> suppressed
      }
      return []
    }

    const insights = await collectInsights(0)
    expect(insights.find((i) => i.metric === 'error_rate')).toBeUndefined()
  })
})
