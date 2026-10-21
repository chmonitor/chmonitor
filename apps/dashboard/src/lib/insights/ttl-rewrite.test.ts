/**
 * TTL rewrite amplification insight (#4069, slice 1).
 *
 * Pure classifier thresholds, the dismissal identity, the SQL contract, and
 * fail-open behaviour. The SQL itself was run against a real ClickHouse with
 * `clickhouse local` (see docs/knowledge/ai-insights.md); these tests pin the
 * text so it cannot drift from what was verified.
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
  TTL_REWRITE_MIN_AMPLIFICATION,
  TTL_REWRITE_MIN_READ_BYTES,
  classifyTtlRewrite,
  insightFromTtlRewriteRows,
  partitionKeyAlignsWithTtl,
} = await import('./ttl-rewrite-classifier')
const { collectTtlRewriteAmplification, ttlRewriteSql } = await import(
  './ttl-rewrite-collector'
)
const { collectInsights } = await import('./collectors')
const { deriveAction } = await import('./read-insights')
const { insightKey } = await import('./types')

const TIB = 1024 ** 4
const GIB = 1024 ** 3

function rec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    database: 'shop',
    table: 'events',
    ttl_read_bytes: 2 * TIB,
    ingest_bytes: 100 * GIB,
    partition_key: 'toYYYYMM(ts)',
    ttl_expression: 'ts + toIntervalDay(90)',
    ttl_only_drop_parts: '0',
    ...over,
  }
}

function verdict(over: Record<string, unknown> = {}) {
  const [candidate] = insightFromTtlRewriteRows([rec(over)])
  return candidate
}

describe('thresholds', () => {
  test('constants are 1 TiB and 4x', () => {
    expect(TTL_REWRITE_MIN_READ_BYTES).toBe(TIB)
    expect(TTL_REWRITE_MIN_AMPLIFICATION).toBe(4)
  })

  test('flags at exactly 1 TiB and exactly 4x', () => {
    expect(
      verdict({ ttl_read_bytes: TIB, ingest_bytes: TIB / 4 })
    ).toBeDefined()
  })

  test('does not flag one byte under 1 TiB even at huge amplification', () => {
    expect(
      verdict({ ttl_read_bytes: TIB - 1, ingest_bytes: 1 })
    ).toBeUndefined()
  })

  test('does not flag just under 4x', () => {
    expect(
      verdict({ ttl_read_bytes: 4 * TIB - 1, ingest_bytes: TIB })
    ).toBeUndefined()
  })

  test('a rewrite with no recorded ingest counts as amplified', () => {
    const c = verdict({ ingest_bytes: 0 })
    expect(c).toBeDefined()
    expect(c?.detail).toContain('no ingest recorded')
  })

  test('amplification is read over ingest', () => {
    const v = classifyTtlRewrite({
      database: 'd',
      table: 't',
      ttlReadBytes: 8 * TIB,
      ingestBytes: TIB,
      partitionKey: 'toYYYYMM(ts)',
      ttlExpression: 'ts + toIntervalDay(1)',
      ttlOnlyDropParts: '0',
    })
    expect(v.amplification).toBe(8)
    expect(v.flagged).toBe(true)
  })
})

describe('exclusions', () => {
  test('ttl_only_drop_parts = 1 is excluded, 0 and unknown are not', () => {
    expect(verdict({ ttl_only_drop_parts: '1' })).toBeUndefined()
    expect(verdict({ ttl_only_drop_parts: '0' })).toBeDefined()
    expect(verdict({ ttl_only_drop_parts: '' })).toBeDefined()
  })

  test('a table without a TTL is excluded', () => {
    expect(verdict({ ttl_expression: '' })).toBeUndefined()
  })

  test('a day-granular partition key on the TTL column is excluded', () => {
    expect(verdict({ partition_key: 'toDate(ts)' })).toBeUndefined()
    expect(verdict({ partition_key: 'toYYYYMMDD(ts)' })).toBeUndefined()
    expect(
      verdict({ partition_key: '(tenant, toStartOfDay(ts))' })
    ).toBeUndefined()
  })

  test('a coarse partition key on the TTL column is the problem case', () => {
    for (const key of [
      'toYYYYMM(ts)',
      '(tenant, toYYYYMM(ts))',
      'toMonday(ts)',
      'toStartOfMonth(ts)',
      'toYear(ts)',
    ]) {
      expect(verdict({ partition_key: key })).toBeDefined()
    }
  })

  test('a partition key on another column is flagged', () => {
    expect(verdict({ partition_key: 'toDate(created_at)' })).toBeDefined()
    expect(verdict({ partition_key: '' })).toBeDefined()
  })

  test('column matching ignores functions, units, keywords and string literals', () => {
    expect(
      partitionKeyAlignsWithTtl(
        'toDate(event_time)',
        "toDateTime(event_time) + INTERVAL 30 DAY DELETE WHERE kind = 'DAY'"
      )
    ).toBe(true)
    // `day` is only a unit here, never the partition column.
    expect(partitionKeyAlignsWithTtl('day', 'ts + INTERVAL 1 DAY')).toBe(false)
    expect(
      partitionKeyAlignsWithTtl(
        'toDate(`my col`)',
        '`my col` + toIntervalDay(7)'
      )
    ).toBe(true)
  })
})

describe('insight shape', () => {
  test('severity is warning, never critical, however large the numbers', () => {
    const c = verdict({ ttl_read_bytes: 5000 * TIB, ingest_bytes: 1 })
    expect(c?.severity).toBe('warning')
  })

  test('emits one insight for the table with the most TTL bytes read', () => {
    const out = insightFromTtlRewriteRows([
      rec({ table: 'small', ttl_read_bytes: 2 * TIB }),
      rec({ table: 'big', ttl_read_bytes: 9 * TIB }),
      rec({ table: 'mid', ttl_read_bytes: 5 * TIB }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.metric).toBe('ttl_rewrite:shop.big')
  })

  test('the worst table is chosen among those that pass the classifier', () => {
    const out = insightFromTtlRewriteRows([
      rec({
        table: 'dropper',
        ttl_read_bytes: 99 * TIB,
        ttl_only_drop_parts: '1',
      }),
      rec({ table: 'real', ttl_read_bytes: 2 * TIB }),
    ])
    expect(out[0]?.metric).toBe('ttl_rewrite:shop.real')
  })

  test('detail carries the evidence and the cost-issue caveat', () => {
    const c = verdict()
    const detail = c?.detail ?? ''
    expect(detail).toContain('shop.events')
    expect(detail).toContain('2 TiB')
    expect(detail).toContain('100 GiB')
    expect(detail).toContain('20.5x')
    expect(detail).toContain('14 days')
    expect(detail).toContain('cost issue')
    expect(detail).toContain('engine_full')
    expect(detail).toContain('ttl_only_drop_parts = 1')
  })

  test('the suggested action never carries data-dropping DDL', () => {
    const c = verdict()
    const text = JSON.stringify(c)
    expect(text).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|ALTER)\b/i)
    expect(c?.action?.href).toBe('/ttl-partition-health')
  })

  test('non-array input yields nothing', () => {
    expect(insightFromTtlRewriteRows(undefined)).toEqual([])
    expect(insightFromTtlRewriteRows({})).toEqual([])
  })
})

describe('identity determinism (the dismissal survives regeneration)', () => {
  test('key is identical while byte counts change', () => {
    const a = verdict({ ttl_read_bytes: 2 * TIB, ingest_bytes: 100 * GIB })
    const b = verdict({ ttl_read_bytes: 7 * TIB, ingest_bytes: 300 * GIB })
    expect(a?.detail).not.toBe(b?.detail)
    expect(insightKey(0, a as never)).toBe(insightKey(0, b as never))
  })

  test('title is count-free and the table lives in the metric', () => {
    const c = verdict()
    expect(c?.title).toBe('shop.events rewrites data to expire its TTL')
    expect(c?.title).not.toMatch(/\d/)
    expect(c?.metric).toBe('ttl_rewrite:shop.events')
  })

  test('two tables get two distinct dismissal keys', () => {
    const a = verdict({ table: 'events' })
    const b = verdict({ table: 'clicks' })
    expect(insightKey(0, a as never)).not.toBe(insightKey(0, b as never))
  })
})

describe('SQL contract', () => {
  test('is read-only, bounded by event_date and a LIMIT', () => {
    expect(ttlRewriteSql).toMatch(/event_date >= today\(\) - 14/)
    expect(ttlRewriteSql).toMatch(/LIMIT \d+\s*$/)
    expect(ttlRewriteSql).toContain("merge_reason = 'TTLDeleteMerge'")
    expect(ttlRewriteSql).toContain("event_type = 'NewPart'")
    expect(ttlRewriteSql).toContain(String(TIB))
    expect(ttlRewriteSql).toMatch(/ttl_only_drop_parts != '1'/)
    expect(ttlRewriteSql).toContain('system.merge_tree_settings')
    expect(ttlRewriteSql.trimStart()).toMatch(/^WITH\b/)
    expect(ttlRewriteSql).not.toMatch(
      /\b(ALTER|DROP|INSERT|TRUNCATE|OPTIMIZE|KILL|DELETE)\b/i
    )
    // The cap travels as a client setting, never a SQL clause (#3684).
    expect(ttlRewriteSql).not.toMatch(/SETTINGS\s+max_execution_time/i)
  })

  test('reads the TTL from engine_full, not create_table_query', () => {
    expect(ttlRewriteSql).toContain('engine_full')
    expect(ttlRewriteSql).not.toContain('create_table_query')
  })

  test('sends max_execution_time as a client setting', async () => {
    calls.length = 0
    handler = () => []
    await collectTtlRewriteAmplification(3)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.hostId).toBe(3)
    expect(calls[0]?.query).toBe(ttlRewriteSql)
    expect(calls[0]?.clickhouse_settings).toEqual({ max_execution_time: 25 })
  })
})

describe('collector', () => {
  test('maps returned rows to one insight', async () => {
    handler = () => [rec()]
    const out = await collectTtlRewriteAmplification(0)
    expect(out).toHaveLength(1)
    expect(out[0]?.metric).toBe('ttl_rewrite:shop.events')
  })

  test('fails open to [] when the query throws (part_log missing or disabled)', async () => {
    handler = () => {
      throw new Error("Unknown table expression identifier 'system.part_log'")
    }
    expect(await collectTtlRewriteAmplification(0)).toEqual([])
  })

  test('collectInsights surfaces it and survives its failure', async () => {
    handler = (opts) =>
      String(opts.query).includes('TTLDeleteMerge') ? [rec()] : []
    const withRewrite = await collectInsights(0)
    expect(
      withRewrite.filter((i) => i.metric === 'ttl_rewrite:shop.events')
    ).toHaveLength(1)

    handler = (opts) => {
      if (String(opts.query).includes('TTLDeleteMerge')) throw new Error('boom')
      return []
    }
    const without = await collectInsights(0)
    expect(without.some((i) => i.metric?.startsWith('ttl_rewrite:'))).toBe(
      false
    )
  })
})

describe('deriveAction', () => {
  test('a per-table ttl_rewrite metric links to the TTL inventory', () => {
    expect(deriveAction('ttl_rewrite:shop.events', 'storage')?.href).toBe(
      '/ttl-partition-health'
    )
    expect(deriveAction('ttl_rewrite:a.b', 'storage')?.label).toBe(
      'View TTL inventory'
    )
  })

  test('the metric emitted by the collector resolves to a link', () => {
    const c = verdict()
    expect(deriveAction(c?.metric ?? '', c?.category ?? '')?.href).toBe(
      '/ttl-partition-health'
    )
  })
})
