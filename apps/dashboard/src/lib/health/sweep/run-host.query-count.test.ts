/**
 * Sweep query-count tests (issue #3682) — the acceptance criterion, measured
 * through the real `runHostSweep`.
 *
 * `batch-kpi.test.ts` counts statements by construction. This file counts them
 * through the actual sweep orchestrator with one fake `fetchData`, so the number
 * includes everything the tick really does: the capability probe, the batch,
 * the per-rule fallback, and the unbatched heavy rules.
 *
 * The claim under test is the issue's: **total background queries per host per
 * sweep down at least 50%**. Both numbers are printed by the `> reports the
 * measured counts` test so a reviewer reading CI output sees 13 → 4 rather than
 * a bare pass.
 */

import type { SweepHostSummary } from './run-host'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

interface FetchArgs {
  query: string
  hostId?: number
  clickhouse_settings?: Record<string, unknown>
}

const queries: string[] = []
/** Settings sent with each entry of `queries`, same index. */
const settingsSent: Array<Record<string, unknown> | undefined> = []
/** Ids whose `system.*` table the fake capability probe reports as present. */
let presentTables = new Set<string>()
/** Make the batched statement fail, to exercise the per-rule fallback. */
let batchFails = false

/** Recognise the capability probe by its `'table' AS kind` shape. */
const isCapabilityProbe = (q: string) =>
  q.includes('system.tables') && q.includes("'table' AS kind")

mock.module('@chm/clickhouse-client', () => ({
  fetchData: async ({ query, clickhouse_settings }: FetchArgs) => {
    queries.push(query)
    settingsSent.push(clickhouse_settings)

    if (query.includes('AS rule_id')) {
      if (batchFails) {
        return {
          data: null,
          metadata: {},
          error: { type: 'query_error', message: 'batch exploded' },
        }
      }
      // No rows: every batched KPI parses as 0, which is `ok` for the
      // built-ins' `>= 1` thresholds. This is what a healthy tick looks like.
      return { data: [], metadata: {}, error: undefined }
    }

    if (isCapabilityProbe(query)) {
      return {
        data: [
          { kind: 'table', name: 'system.parts' },
          { kind: 'table', name: 'system.disks' },
          { kind: 'table', name: 'system.replicas' },
          ...[...presentTables].map((t) => ({ kind: 'table', name: t })),
          { kind: 'cluster', name: 'default' },
        ],
        metadata: {},
        error: undefined,
      }
    }

    // A heavy per-rule statement (the two system.parts scans, or the per-rule
    // fallback): one row, value 0.
    return { data: [{ v: '0' }], metadata: {}, error: undefined }
  },
  getClickHouseConfigs: () => [
    { id: 0, host: 'test-host', user: 'default', password: '' },
  ],
}))

mock.module('@/lib/insights/generate-insights', () => ({
  generateInsights: async () => [],
}))
mock.module('@/lib/insights/generate-postgres-insights', () => ({
  generatePostgresInsights: async () => [],
}))
mock.module('@/lib/insights/generate-peerdb-insights', () => ({
  generatePeerDBInsights: async () => [],
}))

const { BUILTIN_RULES } = await import('@/lib/alerting/builtin-rules')
const { resetHostCapabilities, setCapabilityCacheClock } = await import(
  '../capability-cache'
)
const { runHostSweep } = await import('./run-host')
const { classifyValue } = await import('@/lib/alerting/rule-registry')

let fakeNow = 1_000_000
const clock = () => fakeNow

const config = { id: 0, host: 'test-host', user: 'default', password: '' }

const sweepContext = {
  alertingEnabled: false,
  rules: BUILTIN_RULES,
  thresholdOverrides: {},
  orderedCompoundRules: [],
} as unknown as Parameters<typeof runHostSweep>[1]

const noopDispatch = async () => {}

beforeEach(() => {
  queries.length = 0
  batchFails = false
  // Every table the built-in rules gate on, so nothing is skipped and the
  // counts are the true worst case.
  presentTables = new Set([
    'system.replicas',
    'system.disks',
    'system.error_log',
    'system.mutations',
    'system.merges',
    'system.query_log',
    'system.backup_log',
    'system.view_refreshes',
    'system.text_log',
    'system.parts',
  ])
  fakeNow = 1_000_000
  setCapabilityCacheClock(clock)
  resetHostCapabilities()
})

/** Run one tick and count the statements it issued. */
async function tick(): Promise<{ total: number; summary: SweepHostSummary }> {
  queries.length = 0
  settingsSent.length = 0
  const result = await runHostSweep(config, sweepContext, noopDispatch)
  return { total: queries.length, summary: result.summary }
}

/**
 * The pre-#3682 cost of one tick, derived from the same rule set: one
 * `system.tables` probe plus one statement per rule. Hard-coded as a named
 * constant rather than recomputed, because it is the baseline the issue
 * measured and a reviewer should be able to check it by inspection.
 */
const BEFORE_PER_TICK = 1 + BUILTIN_RULES.length

describe('background queries per host per sweep', () => {
  test('a cold-cache tick is at least 50% below the pre-fix tick', async () => {
    // The issue's acceptance criterion, end to end through `runHostSweep`.
    const cold = await tick()

    // Cold: capability probe (1) + batched KPIs (1) + the two `system.parts`
    // scans that stay unbatched (2).
    expect(cold.total).toBe(4)
    expect(cold.total).toBeLessThanOrEqual(BEFORE_PER_TICK * 0.5)
  })

  test('a warm-cache tick is cheaper still, because the probe is amortised', async () => {
    await tick() // prime the capability cache
    const warm = await tick()

    // No probe: batch (1) + the two heavy scans (2).
    expect(warm.total).toBe(3)
    expect(warm.total).toBeLessThan(BEFORE_PER_TICK * 0.3)
  })

  test('reports the measured counts so CI output shows 13 → 4', async () => {
    const cold = await tick()
    const reduction = Math.round((1 - cold.total / BEFORE_PER_TICK) * 100)
    console.log(
      `queries per host per sweep: before=${BEFORE_PER_TICK} after=${cold.total} (−${reduction}%)`
    )
    expect({
      before: BEFORE_PER_TICK,
      after: cold.total,
      reductionPct: reduction,
    }).toEqual({ before: 13, after: 4, reductionPct: 69 })
  })

  test('the count does not grow once the cache is warm', async () => {
    // The regression guard for the cache itself: 20 consecutive ticks must not
    // send 20 capability probes.
    await tick()
    const counts: number[] = []
    for (let i = 0; i < 20; i++) {
      const { total } = await tick()
      counts.push(total)
      fakeNow += 60 * 1000
    }
    // 20 ticks × 1 minute = 20 minutes, so the 10-minute TTL lapses twice.
    // The point is that the count is flat and small, not that it is constant.
    expect(Math.max(...counts)).toBeLessThanOrEqual(4)
    expect(new Set(counts).size).toBeLessThanOrEqual(3)
  })

  test('every rule still runs — the saving is in statements, not coverage', async () => {
    // The safety property that makes the whole change acceptable. If batching
    // had dropped a check, `checksRun` would fall below the rule count.
    const { summary } = await tick()
    expect(summary.checksRun).toBe(BUILTIN_RULES.length)
    expect(summary.errored).toBe(0)
  })

  test('the batch carries every batchable rule and the heavy scans stay separate', async () => {
    await tick()
    const batch = queries.find((q) => q.includes('AS rule_id'))
    expect(batch).toBeDefined()
    // 12 rules, 2 excluded → 10 branches, 9 joins.
    expect(batch!.match(/AS rule_id/g)).toHaveLength(10)
    expect(batch!.match(/UNION ALL/g)).toHaveLength(9)
    // The `system.parts` scans are separate statements.
    const partsScans = queries.filter(
      (q) => !q.includes('AS rule_id') && q.includes('system.parts')
    )
    expect(partsScans.length).toBeGreaterThanOrEqual(2)
  })

  test('no single rule SQL is sent on its own any more', async () => {
    // Every batchable rule's SQL must appear only INSIDE the batch, never as a
    // standalone statement. A regression here would silently undo the saving.
    await tick()
    for (const r of BUILTIN_RULES) {
      if (
        !r.sql ||
        r.id === 'parts-pressure' ||
        r.id === 'ttl-partition-health'
      ) {
        continue
      }
      const standalone = queries.filter(
        (q) => !q.includes('AS rule_id') && q.includes(r.sql!.trim())
      )
      expect(standalone).toEqual([])
    }
  })
})

describe('the batch fallback', () => {
  test('a failed batch re-runs every rule individually and still reports them', async () => {
    // One bad branch fails the whole `UNION ALL`. Without the fallback, ten
    // working health checks would go dark because of one broken one.
    batchFails = true
    const cold = await tick()

    // 1 capability probe + 1 failed batch attempt + 10 individual batched
    // rules + 2 heavy = 14, i.e. the pre-fix cost of 13 plus the failed attempt.
    // A tick that loses the batch is slower than before by exactly one
    // statement, and only while the failure persists — that is the intended
    // trade. Degrading to "blind" would not be.
    expect(cold.total).toBe(BEFORE_PER_TICK + 1)
    expect(cold.summary.checksRun).toBe(BUILTIN_RULES.length)
    expect(cold.summary.errored).toBe(0)
  })

  test('a failed batch does not poison the next tick', async () => {
    batchFails = true
    await tick()
    batchFails = false
    fakeNow += 11 * 60 * 1000 // past the capability TTL
    const recovered = await tick()
    expect(recovered.total).toBe(4)
  })

  test('a missing optional table skips its rule instead of erroring', async () => {
    // #3682 bullet 1: the table set comes from the capability cache, so a
    // server without `system.backup_log` skips one rule rather than erroring on
    // it — and the rule costs no statement.
    presentTables = new Set(
      [...presentTables].filter((t) => t !== 'system.backup_log')
    )
    const { summary } = await tick()
    expect(summary.skipped).toBe(1)
    expect(summary.errored).toBe(0)
    expect(queries.filter((q) => q.includes('system.backup_log'))).toEqual([])
  })

  test('a missing optional table shrinks the batch, not the tick', async () => {
    presentTables = new Set(
      [...presentTables].filter((t) => t !== 'system.backup_log')
    )
    await tick()
    const batch = queries.find((q) => q.includes('AS rule_id'))!
    expect(batch).not.toContain('system.backup_log')
    expect(batch.match(/AS rule_id/g)).toHaveLength(9)
  })
})

describe('classification is unchanged by batching', () => {
  test('absent batch rows do not invent findings', async () => {
    // Every batched KPI parses as 0 → `ok` under the built-ins' `>= 1`
    // thresholds. If batching could fabricate findings out of absent rows the
    // health page would light up on every healthy cluster.
    const result = await runHostSweep(config, sweepContext, noopDispatch)
    expect(result.findings).toEqual([])
    expect(result.summary.checksRun).toBe(BUILTIN_RULES.length)
    expect(result.summary.errored).toBe(0)
  })

  test('classifyValue sees numbers, not the strings the batch returns', () => {
    // The parse step. A batched value arrives as `toString(...)` and must
    // classify identically to the number the unbatched path produced.
    expect(classifyValue(Number('0'), { warning: 1, critical: 3 })).toBe('ok')
    expect(classifyValue(Number('1'), { warning: 1, critical: 3 })).toBe(
      'warning'
    )
    expect(classifyValue(Number('3'), { warning: 1, critical: 3 })).toBe(
      'critical'
    )
  })
})

describe('per-rule settings (#3684)', () => {
  const ttlRule = BUILTIN_RULES.find((r) => r.id === 'ttl-partition-health')

  function ttlSettings(): Array<Record<string, unknown> | undefined> {
    const sql = ttlRule!.sql!.trim()
    return queries
      .map((q, i) => (q.includes(sql) ? settingsSent[i] : null))
      .filter((s) => s !== null)
  }

  test('the TTL scan is sent with its 15s cap and readonly', async () => {
    await tick()
    const sent = ttlSettings()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({ max_execution_time: 15, readonly: '1' })
    expect(ttlRule!.sql).not.toMatch(/SETTINGS\s+max_execution_time/i)
  })

  test('the TTL scan keeps its cap when the batch fails', async () => {
    batchFails = true
    await tick()
    const sent = ttlSettings()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.max_execution_time).toBe(15)
  })
})
