/**
 * Unread table / unused projection insights (#4067, slice 4).
 *
 * Pins the size floor, the log-window gate, the one-card-per-category rule,
 * the dismissal identity, the caveat wording, the SQL contract, fail-open
 * behaviour and the registration in `collectInsights`. The SQL itself was run
 * against a real ClickHouse with `clickhouse local` under `enable_analyzer` 0
 * and 1 (see docs/knowledge/ai-insights.md); these tests pin the text so it
 * cannot drift from what was verified.
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
  USAGE_MIN_BYTES,
  USAGE_MIN_WINDOW_DAYS,
  insightFromUnreadTableRows,
  insightFromUnusedProjectionRows,
} = await import('./usage-classifier')
const { collectUsage, usageUnreadTablesSql, usageUnusedProjectionsSql } =
  await import('./usage-collector')
const { collectInsights } = await import('./collectors')
const { deriveAction } = await import('./read-insights')
const { insightKey } = await import('./types')

const GIB = 1024 ** 3

function rec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    database: 'shop',
    table: 'events',
    bytes: 50 * GIB,
    log_window_start: '2026-10-02',
    log_window_days: 20,
    ...over,
  }
}

function proj(over: Record<string, unknown> = {}): Record<string, unknown> {
  return rec({ name: 'by_user', ...over })
}

const tableCard = (over: Record<string, unknown> = {}) =>
  insightFromUnreadTableRows([rec(over)])[0]
const projCard = (over: Record<string, unknown> = {}) =>
  insightFromUnusedProjectionRows([proj(over)])[0]

describe('thresholds', () => {
  test('constants are 10 GiB and 7 days', () => {
    expect(USAGE_MIN_BYTES).toBe(10 * GIB)
    expect(USAGE_MIN_WINDOW_DAYS).toBe(7)
  })

  test('a table flags at exactly 10 GiB, not one byte under', () => {
    expect(tableCard({ bytes: 10 * GIB })).toBeDefined()
    expect(tableCard({ bytes: 10 * GIB - 1 })).toBeUndefined()
  })

  test('a projection flags at exactly 10 GiB, not one byte under', () => {
    expect(projCard({ bytes: 10 * GIB })).toBeDefined()
    expect(projCard({ bytes: 10 * GIB - 1 })).toBeUndefined()
  })

  test('a log shorter than 7 days returns nothing (it proves nothing)', () => {
    expect(tableCard({ log_window_days: 7 })).toBeDefined()
    expect(tableCard({ log_window_days: 6 })).toBeUndefined()
    expect(projCard({ log_window_days: 6 })).toBeUndefined()
  })

  test('an empty log (NULL window) returns nothing', () => {
    const empty = { log_window_start: null, log_window_days: null }
    expect(tableCard(empty)).toBeUndefined()
    expect(projCard(empty)).toBeUndefined()
  })

  test('non-array input yields nothing', () => {
    expect(insightFromUnreadTableRows(undefined)).toEqual([])
    expect(insightFromUnusedProjectionRows({})).toEqual([])
  })

  test('a table row is never mistaken for a projection row, nor the reverse', () => {
    expect(insightFromUnusedProjectionRows([rec()])).toEqual([])
    expect(insightFromUnreadTableRows([proj()])).toEqual([])
  })
})

describe('one card per category', () => {
  test('only the largest unread table is surfaced', () => {
    const out = insightFromUnreadTableRows([
      rec({ table: 'a', bytes: 20 * GIB }),
      rec({ table: 'b', bytes: 90 * GIB }),
      rec({ table: 'c', bytes: 30 * GIB }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.metric).toBe('usage:unread_table:shop.b')
  })

  test('only the largest unused projection is surfaced', () => {
    const out = insightFromUnusedProjectionRows([
      proj({ name: 'p1', bytes: 20 * GIB }),
      proj({ name: 'p2', bytes: 90 * GIB }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.metric).toBe('usage:unused_projection:shop.events.p2')
  })
})

describe('insight shape', () => {
  test('severity is info, category storage, object in the metric', () => {
    const t = tableCard()
    expect(t?.severity).toBe('info')
    expect(t?.category).toBe('storage')
    expect(t?.metric).toBe('usage:unread_table:shop.events')
    expect(t?.value).toBe(50 * GIB)
    const p = projCard()
    expect(p?.severity).toBe('info')
    expect(p?.metric).toBe('usage:unused_projection:shop.events.by_user')
  })

  test('detail states window start, size, replica scope and unread != unused', () => {
    for (const c of [tableCard(), projCard()]) {
      const detail = c?.detail ?? ''
      expect(detail).toContain('2026-10-02')
      expect(detail).toContain('20 days')
      expect(detail).toContain('50 GiB')
      expect(detail).toContain("Only this replica's system.query_log")
      expect(detail).toContain('Unread is not the same as unused')
      expect(detail).toContain('Nothing is changed')
    }
  })

  test('never emits DDL and never says it is safe to drop', () => {
    for (const c of [tableCard(), projCard()]) {
      const text = JSON.stringify(c)
      expect(text).not.toMatch(
        /\b(DROP|TRUNCATE|DELETE|ALTER|MODIFY TTL|REMOVE)\b/i
      )
      expect(text).not.toMatch(/safe to (drop|delete|remove)/i)
    }
  })

  test('links to the matching page', () => {
    expect(tableCard()?.action).toEqual({
      label: 'View unread tables',
      href: '/unused-tables',
    })
    expect(projCard()?.action).toEqual({
      label: 'View unused projections',
      href: '/unused-projections',
    })
  })
})

describe('identity determinism (the dismissal survives regeneration)', () => {
  test('keys are identical while every number and the window change', () => {
    const a = tableCard()
    const b = tableCard({
      bytes: 300 * GIB,
      log_window_days: 29,
      log_window_start: '2026-09-23',
    })
    expect(a?.detail).not.toBe(b?.detail)
    expect(insightKey(0, a as never)).toBe(insightKey(0, b as never))
    const pa = projCard()
    const pb = projCard({ bytes: 300 * GIB, log_window_days: 29 })
    expect(insightKey(0, pa as never)).toBe(insightKey(0, pb as never))
  })

  test('titles are count-free', () => {
    expect(tableCard()?.title).toBe(
      'shop.events was not read in the query log window'
    )
    expect(tableCard()?.title).not.toMatch(/\d/)
    expect(projCard()?.title).toBe(
      'Projection shop.events.by_user was not used in the query log window'
    )
    expect(projCard()?.title).not.toMatch(/\d/)
  })

  test('two tables get two distinct keys', () => {
    expect(insightKey(0, tableCard({ table: 'a' }) as never)).not.toBe(
      insightKey(0, tableCard({ table: 'b' }) as never)
    )
  })
})

describe('SQL contract', () => {
  for (const [label, sql] of [
    ['tables', usageUnreadTablesSql],
    ['projections', usageUnusedProjectionsSql],
  ] as const) {
    test(`${label}: read-only, event_date bound, LIMIT, analyzer-portable`, () => {
      expect(sql.trimStart()).toMatch(/^WITH\b/)
      expect(sql).toMatch(/event_date >= today\(\) - 30/)
      expect(sql).toMatch(/LIMIT \d+\s*$/)
      expect(sql).toContain("type = 'QueryFinish'")
      expect(sql).toContain("query_kind = 'Select'")
      expect(sql).toContain('minOrNull(event_date)')
      expect(sql).toContain(String(10 * GIB))
      expect(sql).not.toMatch(/->/)
      expect(sql).not.toContain('\\')
      expect(sql).not.toMatch(
        /\b(ALTER|DROP|INSERT|TRUNCATE|OPTIMIZE|KILL|DELETE)\b/i
      )
      expect(sql).not.toMatch(/SETTINGS\s+max_execution_time/i)
    })
  }

  test('the table query only lists local MergeTree tables', () => {
    expect(usageUnreadTablesSql).toContain("engine LIKE '%MergeTree'")
    expect(usageUnreadTablesSql).toContain('FROM system.databases')
  })

  test('sends max_execution_time as a client setting for both queries', async () => {
    calls.length = 0
    handler = () => []
    await collectUsage(3)
    expect(calls).toHaveLength(2)
    expect(calls.map((c) => c.query).sort()).toEqual(
      [usageUnreadTablesSql, usageUnusedProjectionsSql].sort()
    )
    for (const c of calls) {
      expect(c.hostId).toBe(3)
      expect(c.clickhouse_settings).toEqual({ max_execution_time: 25 })
    }
  })
})

describe('collector', () => {
  test('maps rows from both queries to one card each', async () => {
    handler = (opts) =>
      opts.query === usageUnreadTablesSql ? [rec()] : [proj()]
    const out = await collectUsage(0)
    expect(out.map((i) => i.metric)).toEqual([
      'usage:unread_table:shop.events',
      'usage:unused_projection:shop.events.by_user',
    ])
  })

  test('fails open per query: a missing projections table keeps the table card', async () => {
    handler = (opts) => {
      if (opts.query === usageUnusedProjectionsSql)
        throw new Error(
          "Unknown table expression identifier 'system.projections'"
        )
      return [rec()]
    }
    const out = await collectUsage(0)
    expect(out.map((i) => i.metric)).toEqual(['usage:unread_table:shop.events'])
  })

  test('fails open to [] on a missing query_log', async () => {
    handler = () => {
      throw new Error("Unknown table expression identifier 'system.query_log'")
    }
    expect(await collectUsage(0)).toEqual([])
  })

  test('collectInsights surfaces it and survives its failure', async () => {
    handler = (opts) => (opts.query === usageUnreadTablesSql ? [rec()] : [])
    const withUsage = await collectInsights(0)
    expect(
      withUsage.filter((i) => i.metric === 'usage:unread_table:shop.events')
    ).toHaveLength(1)

    handler = (opts) => {
      if (
        opts.query === usageUnreadTablesSql ||
        opts.query === usageUnusedProjectionsSql
      )
        throw new Error('boom')
      return []
    }
    const without = await collectInsights(0)
    expect(without.some((i) => i.metric?.startsWith('usage:'))).toBe(false)
  })
})

describe('deriveAction', () => {
  test('per-object usage metrics link to their pages', () => {
    expect(
      deriveAction('usage:unread_table:shop.events', 'storage')?.href
    ).toBe('/unused-tables')
    expect(
      deriveAction('usage:unused_projection:shop.events.by_user', 'storage')
        ?.href
    ).toBe('/unused-projections')
  })

  test('the metrics emitted by the collector resolve to a link', () => {
    for (const c of [tableCard(), projCard()]) {
      expect(deriveAction(c?.metric ?? '', c?.category ?? '')?.href).toMatch(
        /^\/unused-/
      )
    }
  })
})
