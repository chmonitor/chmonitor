/**
 * Tests for the D1-backed anomaly baseline store.
 *
 * Uses a small behavioral fake of D1Database (prepare/bind/first/all/run)
 * injected through a mocked @chm/platform, so we exercise the real SQL the
 * store issues: the upsert's `ON CONFLICT (host_id, metric) DO UPDATE` (a
 * second write updates in place rather than duplicating), the
 * host_id/metric-scoped reads, and the best-effort degrade when no binding is
 * present. Mirrors `insights/store/d1-store.test.ts`'s fake-D1 pattern.
 */

import type { Baseline } from './statistical-baseline'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// --- behavioral D1 fake ------------------------------------------------------
interface FakeRow {
  host_id: string
  metric: string
  mean: number
  stddev: number
  median: number | null
  mad: number | null
  sample_count: number
  window_start: number | null
  fitted_at: number
}

function makeFakeD1() {
  // Keyed by `${host_id}::${metric}` to mirror the PRIMARY KEY (host_id, metric).
  const rows = new Map<string, FakeRow>()

  function keyFor(hostId: string, metric: string): string {
    return `${hostId}::${metric}`
  }

  function prepare(_sql: string) {
    return {
      bind(...args: unknown[]) {
        return {
          // Only getBaseline calls .first() -- always an exact host_id+metric lookup.
          async first<T>(): Promise<T | null> {
            const [hostId, metric] = args as [string, string]
            return (rows.get(keyFor(hostId, metric)) as unknown as T) ?? null
          },
          // Only listBaselines calls .all() -- always a host-scoped listing.
          async all<T>(): Promise<{ results: T[] }> {
            const [hostId] = args as [string]
            const out = [...rows.values()]
              .filter((r) => r.host_id === hostId)
              .sort((a, b) => a.metric.localeCompare(b.metric))
            return { results: out as unknown as T[] }
          },
          // Only upsertBaseline calls .run() -- always the 9-column upsert.
          async run(): Promise<{ meta: { changes: number } }> {
            const [
              hostId,
              metric,
              mean,
              stddev,
              median,
              mad,
              sampleCount,
              windowStart,
              fittedAt,
            ] = args as [
              string,
              string,
              number,
              number,
              number,
              number,
              number,
              number,
              number,
            ]
            rows.set(keyFor(hostId, metric), {
              host_id: hostId,
              metric,
              mean,
              stddev,
              median,
              mad,
              sample_count: sampleCount,
              window_start: windowStart,
              fitted_at: fittedAt,
            })
            return { meta: { changes: 1 } }
          },
        }
      },
    }
  }

  return { prepare, _rows: rows }
}

// --- inject via mocked platform ---------------------------------------------
let currentDb: ReturnType<typeof makeFakeD1> | null = null

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => currentDb,
  }),
}))

const { getBaseline, upsertBaseline, listBaselines } = await import(
  './baseline-store'
)

const baseline = (over: Partial<Baseline> = {}): Baseline => ({
  hostId: '0',
  metric: 'error_rate',
  mean: 100,
  stddev: 10,
  median: 99,
  mad: 7,
  sampleCount: 168,
  windowStart: 1000,
  fittedAt: 2000,
  ...over,
})

beforeEach(() => {
  currentDb = makeFakeD1()
})

describe('baseline-store', () => {
  test('upsert then getBaseline round-trips every field', async () => {
    await upsertBaseline(baseline())
    expect(await getBaseline('0', 'error_rate')).toEqual(baseline())
  })

  test('a second upsert on the same host/metric updates in place, not a duplicate row', async () => {
    await upsertBaseline(baseline({ mean: 100, sampleCount: 100 }))
    await upsertBaseline(
      baseline({ mean: 105, sampleCount: 200, fittedAt: 3000 })
    )

    const result = await getBaseline('0', 'error_rate')
    expect(result?.mean).toBe(105)
    expect(result?.sampleCount).toBe(200)
    expect(result?.fittedAt).toBe(3000)

    // Updated in place -- listBaselines must still show exactly one row.
    expect((await listBaselines('0')).length).toBe(1)
  })

  test('listBaselines returns every metric for a host, ordered by metric', async () => {
    await upsertBaseline(baseline({ metric: 'query_duration_p95' }))
    await upsertBaseline(baseline({ metric: 'error_rate' }))
    await upsertBaseline(baseline({ metric: 'memory_usage' }))

    expect((await listBaselines('0')).map((b) => b.metric)).toEqual([
      'error_rate',
      'memory_usage',
      'query_duration_p95',
    ])
  })

  test('listBaselines only returns rows for the requested host', async () => {
    await upsertBaseline(baseline({ hostId: '0' }))
    await upsertBaseline(baseline({ hostId: '1' }))

    expect((await listBaselines('0')).map((b) => b.hostId)).toEqual(['0'])
    expect((await listBaselines('1')).map((b) => b.hostId)).toEqual(['1'])
  })

  test('getBaseline returns null for an unknown host/metric', async () => {
    expect(await getBaseline('0', 'unknown_metric')).toBeNull()
  })

  test('degrades to null/[] (never throws) when no D1 binding is present', async () => {
    currentDb = null

    expect(await getBaseline('0', 'error_rate')).toBeNull()
    expect(await listBaselines('0')).toEqual([])

    await upsertBaseline(baseline()) // must resolve without throwing
    expect(await getBaseline('0', 'error_rate')).toBeNull() // still nothing to read back
  })
})
