/**
 * Per-table retention forecast insight (#4069, slice 2).
 *
 * Pure classifier thresholds, the freed-bytes wording, the dismissal identity,
 * the SQL contract, fail-open behaviour and the registration in
 * `collectInsights`. The SQL itself was run against a real ClickHouse with
 * `clickhouse local` under `enable_analyzer` 0 and 1 (see
 * docs/knowledge/ai-insights.md); these tests pin the text so it cannot drift
 * from what was verified.
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
  RETENTION_MIN_DISK_BYTES,
  RETENTION_MIN_INGEST_SHARE,
  classifyRetentionForecast,
  insightFromRetentionForecastRows,
} = await import('./retention-forecast-classifier')
const { collectRetentionForecast, retentionForecastSql } = await import(
  './retention-forecast-collector'
)
const { collectInsights } = await import('./collectors')
const { deriveAction } = await import('./read-insights')
const { insightKey } = await import('./types')

const GIB = 1024 ** 3

function rec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    database: 'shop',
    table: 'events',
    ingest_bytes: 600 * GIB,
    total_ingest_bytes: 1000 * GIB,
    window_days: 10,
    disk_bytes: 300 * GIB,
    older_12m_bytes: 200 * GIB,
    older_24m_bytes: 100 * GIB,
    older_36m_bytes: 50 * GIB,
    has_ttl: 0,
    ...over,
  }
}

function candidate(over: Record<string, unknown> = {}) {
  return insightFromRetentionForecastRows([rec(over)])[0]
}

describe('thresholds', () => {
  test('constants are 50% and 100 GiB', () => {
    expect(RETENTION_MIN_INGEST_SHARE).toBe(0.5)
    expect(RETENTION_MIN_DISK_BYTES).toBe(100 * GIB)
  })

  test('flags at exactly 50% share and exactly 100 GiB', () => {
    expect(
      candidate({
        ingest_bytes: 500 * GIB,
        total_ingest_bytes: 1000 * GIB,
        disk_bytes: 100 * GIB,
      })
    ).toBeDefined()
  })

  test('does not flag one byte under 50% share', () => {
    expect(
      candidate({
        ingest_bytes: 500 * GIB - 1,
        total_ingest_bytes: 1000 * GIB,
      })
    ).toBeUndefined()
  })

  test('does not flag one byte under 100 GiB on disk', () => {
    expect(candidate({ disk_bytes: 100 * GIB - 1 })).toBeUndefined()
  })

  test('zero total ingest never flags (no divide by zero)', () => {
    expect(
      candidate({ ingest_bytes: 0, total_ingest_bytes: 0 })
    ).toBeUndefined()
  })

  test('share and average ingest per day come from the observed window', () => {
    const v = classifyRetentionForecast({
      database: 'd',
      table: 't',
      ingestBytes: 600 * GIB,
      totalIngestBytes: 1000 * GIB,
      windowDays: 10,
      diskBytes: 300 * GIB,
      olderThan12mBytes: 0,
      olderThan24mBytes: 0,
      olderThan36mBytes: 0,
      hasTtl: false,
    })
    expect(v.share).toBe(0.6)
    expect(v.avgIngestPerDay).toBe(60 * GIB)
    expect(v.flagged).toBe(true)
  })
})

describe('TTL exclusion', () => {
  test('a table with a TTL is never flagged however dominant', () => {
    expect(
      candidate({ has_ttl: 1, ingest_bytes: 999 * GIB, disk_bytes: 5000 * GIB })
    ).toBeUndefined()
  })

  test('a missing flag is treated as a TTL (fail closed, no false "no TTL")', () => {
    const { has_ttl: _omit, ...noFlag } = rec()
    expect(insightFromRetentionForecastRows([noFlag])).toEqual([])
  })
})

describe('insight shape', () => {
  test('severity is info and the table is in the metric', () => {
    const c = candidate()
    expect(c?.severity).toBe('info')
    expect(c?.category).toBe('storage')
    expect(c?.metric).toBe('retention_forecast:shop.events')
    expect(c?.value).toBe(60)
  })

  test('emits one insight, for the table with the most ingest', () => {
    const out = insightFromRetentionForecastRows([
      rec({ table: 'a', ingest_bytes: 510 * GIB }),
      rec({ table: 'b', ingest_bytes: 700 * GIB }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.metric).toBe('retention_forecast:shop.b')
  })

  test('detail carries share, rate, size and the 12/24/36 month freed bytes', () => {
    const detail = candidate()?.detail ?? ''
    expect(detail).toContain('shop.events')
    expect(detail).toContain('60%')
    expect(detail).toContain('60 GiB per day')
    expect(detail).toContain('last 10 days')
    expect(detail).toContain('300 GiB on disk')
    expect(detail).toContain('older than 12 months is 200 GiB')
    expect(detail).toContain('older than 24 months 100 GiB')
    expect(detail).toContain('older than 36 months 50 GiB')
  })

  test('detail states the forecast, the part_log limit and the owner decision', () => {
    const detail = candidate()?.detail ?? ''
    expect(detail).toContain('forecast from the system.part_log window')
    expect(detail).toContain('part_log retention limits that window')
    expect(detail).toContain('decision for the table owner')
  })

  test('never emits DDL and never says it is safe to drop', () => {
    const text = JSON.stringify(candidate())
    expect(text).not.toMatch(
      /\b(DROP|TRUNCATE|DELETE FROM|ALTER|MODIFY TTL)\b/i
    )
    expect(text).not.toMatch(/safe to (drop|delete)/i)
  })

  test('non-array input yields nothing', () => {
    expect(insightFromRetentionForecastRows(undefined)).toEqual([])
    expect(insightFromRetentionForecastRows({})).toEqual([])
  })
})

describe('identity determinism (the dismissal survives regeneration)', () => {
  test('key is identical while every number changes', () => {
    const a = candidate()
    const b = candidate({
      ingest_bytes: 900 * GIB,
      window_days: 21,
      disk_bytes: 800 * GIB,
      older_12m_bytes: 1,
    })
    expect(a?.detail).not.toBe(b?.detail)
    expect(insightKey(0, a as never)).toBe(insightKey(0, b as never))
  })

  test('title is count-free', () => {
    const c = candidate()
    expect(c?.title).toBe('shop.events dominates ingest and has no TTL')
    expect(c?.title).not.toMatch(/\d/)
  })

  test('two tables get two distinct keys', () => {
    expect(insightKey(0, candidate({ table: 'a' }) as never)).not.toBe(
      insightKey(0, candidate({ table: 'b' }) as never)
    )
  })
})

describe('SQL contract', () => {
  test('is read-only, bounded by event_date and a LIMIT', () => {
    expect(retentionForecastSql).toMatch(/event_date >= today\(\) - 30/)
    expect(retentionForecastSql).toMatch(/LIMIT \d+\s*$/)
    expect(retentionForecastSql).toContain("event_type = 'NewPart'")
    expect(retentionForecastSql).toContain('WHERE active')
    expect(retentionForecastSql).toContain(
      'positionCaseInsensitive(engine_full'
    )
    expect(retentionForecastSql.trimStart()).toMatch(/^WITH\b/)
    expect(retentionForecastSql).not.toMatch(
      /\b(ALTER|DROP|INSERT|TRUNCATE|OPTIMIZE|KILL|DELETE)\b/i
    )
    expect(retentionForecastSql).not.toMatch(/SETTINGS\s+max_execution_time/i)
  })

  test('has no lambda alias in WITH and no backslash (analyzer 0 and 1)', () => {
    expect(retentionForecastSql).not.toMatch(/->/)
    expect(retentionForecastSql).not.toContain('\\')
  })

  test('sends max_execution_time as a client setting', async () => {
    calls.length = 0
    handler = () => []
    await collectRetentionForecast(3)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.hostId).toBe(3)
    expect(calls[0]?.query).toBe(retentionForecastSql)
    expect(calls[0]?.clickhouse_settings).toEqual({ max_execution_time: 25 })
  })
})

describe('collector', () => {
  test('maps returned rows to one insight', async () => {
    handler = () => [rec()]
    const out = await collectRetentionForecast(0)
    expect(out).toHaveLength(1)
    expect(out[0]?.metric).toBe('retention_forecast:shop.events')
  })

  test('fails open to [] on a missing part_log or a missing column', async () => {
    handler = () => {
      throw new Error("Unknown table expression identifier 'system.part_log'")
    }
    expect(await collectRetentionForecast(0)).toEqual([])
    handler = () => {
      throw new Error("Missing columns: 'max_date' while processing query")
    }
    expect(await collectRetentionForecast(0)).toEqual([])
  })

  test('collectInsights surfaces it and survives its failure', async () => {
    handler = (opts) => (String(opts.query).includes('dominant') ? [rec()] : [])
    const withForecast = await collectInsights(0)
    expect(
      withForecast.filter((i) => i.metric === 'retention_forecast:shop.events')
    ).toHaveLength(1)

    handler = (opts) => {
      if (String(opts.query).includes('dominant')) throw new Error('boom')
      return []
    }
    const without = await collectInsights(0)
    expect(
      without.some((i) => i.metric?.startsWith('retention_forecast:'))
    ).toBe(false)
  })
})

describe('deriveAction', () => {
  test('a per-table retention_forecast metric links to the TTL inventory', () => {
    const a = deriveAction('retention_forecast:shop.events', 'storage')
    expect(a?.href).toBe('/ttl-partition-health')
    expect(a?.label).toBe('View TTL inventory')
  })

  test('the metric emitted by the collector resolves to a link', () => {
    const c = candidate()
    expect(deriveAction(c?.metric ?? '', c?.category ?? '')?.href).toBe(
      '/ttl-partition-health'
    )
  })
})
