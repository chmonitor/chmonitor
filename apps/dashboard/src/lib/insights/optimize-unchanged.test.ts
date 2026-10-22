/**
 * OPTIMIZE FINAL on unchanged data insight (#4069, slice 3).
 *
 * Pure classifier thresholds, the dismissal identity, the SQL contract,
 * fail-open behaviour and the registration in `collectInsights`. The SQL was
 * run against a real ClickHouse server (real `system.query_log` and
 * `system.part_log`) and against fake tables under `enable_analyzer` 0 and 1
 * (see docs/knowledge/ai-insights.md); these tests pin the text so it cannot
 * drift from what was verified.
 */

import { describe, expect, mock, test } from 'bun:test'

type QueryHandler = (opts: Record<string, unknown>) => unknown
let handler: QueryHandler = () => []
const calls: Array<Record<string, unknown>> = []

mock.module('../ai/agent/tools/helpers', () => ({
  readOnlyQuery: async (opts: Record<string, unknown>) => {
    calls.push(opts)
    return handler(opts)
  },
}))

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({ getD1Database: () => null }),
}))

const {
  OPTIMIZE_UNCHANGED_MIN_RUNS,
  OPTIMIZE_UNCHANGED_WINDOW_DAYS,
  classifyOptimizeUnchanged,
  insightFromOptimizeUnchangedRows,
} = await import('./optimize-unchanged-classifier')
const { collectOptimizeUnchanged, optimizeUnchangedSql } = await import(
  './optimize-unchanged-collector'
)
const { collectInsights } = await import('./collectors')
const { deriveAction } = await import('./read-insights')
const { insightKey } = await import('./types')

function rec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    database: 'shop',
    table: 'events',
    runs: 5,
    unchanged_runs: 4,
    ...over,
  }
}

function candidate(over: Record<string, unknown> = {}) {
  return insightFromOptimizeUnchangedRows([rec(over)])[0]
}

describe('thresholds', () => {
  test('constants are 3 runs in 14 days', () => {
    expect(OPTIMIZE_UNCHANGED_MIN_RUNS).toBe(3)
    expect(OPTIMIZE_UNCHANGED_WINDOW_DAYS).toBe(14)
  })

  test('flags at exactly 3 unchanged runs, not at 2', () => {
    expect(candidate({ runs: 4, unchanged_runs: 3 })).toBeDefined()
    expect(candidate({ runs: 3, unchanged_runs: 2 })).toBeUndefined()
    expect(candidate({ runs: 100, unchanged_runs: 2 })).toBeUndefined()
  })

  test('the first run never counts: 3 runs can give at most 2 unchanged', () => {
    // 3 runs is not enough even if the input claims 3 unchanged runs.
    expect(candidate({ runs: 3, unchanged_runs: 3 })).toBeUndefined()
    expect(
      classifyOptimizeUnchanged({
        database: 'd',
        table: 't',
        runs: 3,
        unchangedRuns: 3,
      }).flagged
    ).toBe(false)
    // 4 runs with every later run unchanged is the minimum that flags.
    expect(candidate({ runs: 4, unchanged_runs: 3 })).toBeDefined()
  })

  test('many runs with new data in between are not flagged', () => {
    expect(candidate({ runs: 50, unchanged_runs: 0 })).toBeUndefined()
  })

  test('missing or junk numbers fail closed', () => {
    expect(
      candidate({ runs: undefined, unchanged_runs: undefined })
    ).toBeUndefined()
    expect(candidate({ runs: 'x', unchanged_runs: 'y' })).toBeUndefined()
  })

  test('numeric strings from the JSON driver are accepted', () => {
    expect(candidate({ runs: '6', unchanged_runs: '4' })).toBeDefined()
  })

  test('a row without a table is skipped', () => {
    expect(insightFromOptimizeUnchangedRows([rec({ table: '' })])).toEqual([])
    expect(insightFromOptimizeUnchangedRows([null, {}])).toEqual([])
  })
})

describe('insight shape', () => {
  test('severity is info however many runs', () => {
    expect(candidate({ runs: 5000, unchanged_runs: 4999 })?.severity).toBe(
      'info'
    )
    expect(candidate()?.category).toBe('storage')
  })

  test('surfaces at most three tables, the most unchanged runs first', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      rec({ table: `t${i}`, runs: 10 + i, unchanged_runs: 3 + i })
    )
    const out = insightFromOptimizeUnchangedRows(rows)
    expect(out.map((i) => i.metric)).toEqual([
      'optimize_unchanged:shop.t5',
      'optimize_unchanged:shop.t4',
      'optimize_unchanged:shop.t3',
    ])
  })

  test('one insight per flagged table (within the cap), most unchanged runs first', () => {
    const out = insightFromOptimizeUnchangedRows([
      rec({ table: 'few', runs: 4, unchanged_runs: 3 }),
      rec({ table: 'none', runs: 9, unchanged_runs: 1 }),
      rec({ table: 'many', runs: 20, unchanged_runs: 19 }),
    ])
    expect(out.map((i) => i.metric)).toEqual([
      'optimize_unchanged:shop.many',
      'optimize_unchanged:shop.few',
    ])
  })

  test('detail carries the evidence and stays neutral', () => {
    const detail = candidate()?.detail ?? ''
    expect(detail).toContain('shop.events')
    expect(detail).toContain('ran 5 times')
    expect(detail).toContain('4 of those runs')
    expect(detail).toContain('14 days')
    expect(detail).toContain('single replica')
    expect(detail).toContain('Review whether this schedule is needed')
    expect(detail).not.toMatch(/\bsafe\b/i)
  })

  test('never emits DDL or an instruction to run any', () => {
    const c = candidate()
    const text = `${c?.title} ${c?.detail}`
    expect(text).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|ALTER|KILL)\b/i)
    // OPTIMIZE is named as the observed statement, never as a command to run.
    expect(text).not.toMatch(/\b(run|execute|issue)\s+OPTIMIZE\b/i)
    expect(c?.action?.href).toBe('/merges')
  })

  test('non-array input yields nothing', () => {
    expect(insightFromOptimizeUnchangedRows(undefined)).toEqual([])
    expect(insightFromOptimizeUnchangedRows({})).toEqual([])
  })
})

describe('identity determinism (the dismissal survives regeneration)', () => {
  test('key is identical while the run counts change', () => {
    const a = candidate({ runs: 5, unchanged_runs: 4 })
    const b = candidate({ runs: 40, unchanged_runs: 33 })
    expect(a?.detail).not.toBe(b?.detail)
    expect(insightKey(0, a as never)).toBe(insightKey(0, b as never))
  })

  test('title is count-free and the table lives in the metric', () => {
    const c = candidate()
    expect(c?.title).toBe(
      'shop.events is optimized repeatedly with no new data'
    )
    expect(c?.title).not.toMatch(/\d/)
    expect(c?.metric).toBe('optimize_unchanged:shop.events')
  })

  test('two tables get two distinct dismissal keys', () => {
    const a = candidate({ table: 'events' })
    const b = candidate({ table: 'clicks' })
    expect(insightKey(0, a as never)).not.toBe(insightKey(0, b as never))
  })
})

describe('SQL contract', () => {
  test('is read-only, bounded by event_date and a LIMIT', () => {
    expect(optimizeUnchangedSql).toMatch(/event_date >= today\(\) - 14/)
    expect(optimizeUnchangedSql).toMatch(
      /event_time >= now\(\) - INTERVAL 14 DAY/
    )
    expect(optimizeUnchangedSql).toMatch(/LIMIT \d+\s*$/)
    expect(optimizeUnchangedSql.trimStart()).toMatch(/^WITH\b/)
    // Both logs are read with a date bound each.
    expect(optimizeUnchangedSql.match(/event_date >= today\(\)/g)).toHaveLength(
      2
    )
    // `query_kind = 'Optimize'` is the filter, not a statement: strip it first.
    const withoutKind = optimizeUnchangedSql.replace(/'Optimize'/g, '')
    expect(withoutKind).not.toMatch(
      /\b(ALTER|DROP|INSERT|TRUNCATE|OPTIMIZE|KILL|DELETE)\b/i
    )
    // The cap travels as a client setting, never a SQL clause (#3684).
    expect(optimizeUnchangedSql).not.toMatch(/SETTINGS\s+max_execution_time/i)
  })

  test('reads what was observed on a real server', () => {
    expect(optimizeUnchangedSql).toContain('system.query_log')
    expect(optimizeUnchangedSql).toContain('system.part_log')
    expect(optimizeUnchangedSql).toContain("type = 'QueryFinish'")
    expect(optimizeUnchangedSql).toContain("query_kind = 'Optimize'")
    expect(optimizeUnchangedSql).toContain("event_type = 'NewPart'")
    // Same-second runs and inserts need sub-second ordering.
    expect(optimizeUnchangedSql).toContain('event_time_microseconds')
    // Single node: no cluster fan-out.
    expect(optimizeUnchangedSql).not.toMatch(/cluster/i)
  })

  test('only FINAL counts, and the pattern has no backslashes', () => {
    expect(optimizeUnchangedSql).toContain('(?i)[[:space:]]FINAL')
    expect(optimizeUnchangedSql).not.toContain('\\')
  })

  test('has no lambda alias in WITH (breaks under enable_analyzer=0)', () => {
    expect(optimizeUnchangedSql).not.toContain('->')
    expect(optimizeUnchangedSql).not.toMatch(
      /AS\s*\(\s*\w+(\s*,\s*\w+)*\s*\)\s*->/
    )
  })

  test('the threshold in the SQL is the classifier threshold', () => {
    expect(optimizeUnchangedSql).toContain(
      `HAVING unchanged_runs >= ${OPTIMIZE_UNCHANGED_MIN_RUNS}`
    )
  })

  test('sends max_execution_time as a client setting', async () => {
    calls.length = 0
    handler = () => []
    await collectOptimizeUnchanged(3)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.hostId).toBe(3)
    expect(calls[0]?.query).toBe(optimizeUnchangedSql)
    expect(calls[0]?.clickhouse_settings).toEqual({ max_execution_time: 25 })
  })
})

describe('collector', () => {
  test('maps returned rows to insights', async () => {
    handler = () => [rec()]
    const out = await collectOptimizeUnchanged(0)
    expect(out).toHaveLength(1)
    expect(out[0]?.metric).toBe('optimize_unchanged:shop.events')
  })

  test('fails open to [] when the query throws (log missing or disabled)', async () => {
    handler = () => {
      throw new Error("Unknown table expression identifier 'system.part_log'")
    }
    expect(await collectOptimizeUnchanged(0)).toEqual([])
  })

  test('fails open to [] on a malformed result', async () => {
    handler = () => 'not rows'
    expect(await collectOptimizeUnchanged(0)).toEqual([])
  })

  test('collectInsights surfaces it and survives its failure', async () => {
    handler = (opts) =>
      String(opts.query).includes("query_kind = 'Optimize'") ? [rec()] : []
    const withIt = await collectInsights(0)
    expect(
      withIt.filter((i) => i.metric === 'optimize_unchanged:shop.events')
    ).toHaveLength(1)

    handler = (opts) => {
      if (String(opts.query).includes("query_kind = 'Optimize'"))
        throw new Error('boom')
      return []
    }
    const without = await collectInsights(0)
    expect(
      without.some((i) => i.metric?.startsWith('optimize_unchanged:'))
    ).toBe(false)
  })
})

describe('deriveAction', () => {
  test('a per-table optimize_unchanged metric links to the merges page', () => {
    expect(
      deriveAction('optimize_unchanged:shop.events', 'storage')?.href
    ).toBe('/merges')
    expect(deriveAction('optimize_unchanged:a.b', 'storage')?.label).toBe(
      'View merges'
    )
  })

  test('the metric emitted by the collector resolves to a link', () => {
    const c = candidate()
    expect(deriveAction(c?.metric ?? '', c?.category ?? '')?.href).toBe(
      '/merges'
    )
  })
})
