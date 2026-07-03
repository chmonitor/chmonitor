/**
 * Tests for the D1-backed alert-history store.
 *
 * Uses a small behavioral fake of D1Database (prepare/bind/run/all) injected
 * through a mocked @chm/platform, so we exercise the real SQL the store
 * issues: the insert, the host_id/day-scoped reads (via a LIKE date-prefix
 * match), the `limit` cap, and the best-effort degrade when no binding is
 * present or the D1 call itself throws. Mirrors
 * `insights/baseline-store.test.ts`'s fake-D1 pattern.
 *
 * WHY these matter: this store backs both the sweep's post-delivery audit
 * write and the filtered read API — a bug here either silently drops history
 * (round-trip) or, worse, throws into the sweep and could delay/drop a real
 * alert (fail-open path).
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// --- behavioral D1 fake ------------------------------------------------------
interface FakeRow {
  id: string
  event_time: string
  host_id: number
  host_label: string | null
  rule: string
  severity: string
  prev_severity: string | null
  decision_kind: string
  delivered: number
  error: string | null
  value: number | null
  channel: string | null
}

function makeFakeD1() {
  const rows: FakeRow[] = []

  function prepare(sql: string) {
    const isInsert = /^\s*INSERT INTO/i.test(sql)
    const hasHostFilter = /host_id = \?/.test(sql)
    const hasDayFilter = /event_time LIKE \?/.test(sql)

    return {
      bind(...args: unknown[]) {
        return {
          async run(): Promise<{ meta: { changes: number } }> {
            if (!isInsert)
              throw new Error('fake D1: run() called on non-INSERT')
            const [
              id,
              eventTime,
              hostId,
              hostLabel,
              rule,
              severity,
              prevSeverity,
              decisionKind,
              delivered,
              error,
              value,
              channel,
            ] = args as [
              string,
              string,
              number,
              string | null,
              string,
              string,
              string | null,
              string,
              number,
              string | null,
              number | null,
              string | null,
            ]
            rows.push({
              id,
              event_time: eventTime,
              host_id: hostId,
              host_label: hostLabel,
              rule,
              severity,
              prev_severity: prevSeverity,
              decision_kind: decisionKind,
              delivered,
              error,
              value,
              channel,
            })
            return { meta: { changes: 1 } }
          },
          async all<T>(): Promise<{ results: T[] }> {
            let idx = 0
            let filtered = rows
            if (hasHostFilter) {
              const hostId = args[idx++] as number
              filtered = filtered.filter((r) => r.host_id === hostId)
            }
            if (hasDayFilter) {
              const dayLike = args[idx++] as string
              const prefix = dayLike.replace(/%$/, '')
              filtered = filtered.filter((r) => r.event_time.startsWith(prefix))
            }
            const limit = args[idx] as number
            const sorted = [...filtered].sort((a, b) =>
              b.event_time.localeCompare(a.event_time)
            )
            return { results: sorted.slice(0, limit) as unknown as T[] }
          },
        }
      },
    }
  }

  return { prepare, _rows: rows }
}

/** A D1 stand-in whose every call throws, to exercise the swallow-on-error path. */
function makeThrowingD1() {
  return {
    prepare() {
      throw new Error('boom: D1 unavailable')
    },
  }
}

// --- inject via mocked platform ---------------------------------------------
let currentDb:
  | ReturnType<typeof makeFakeD1>
  | ReturnType<typeof makeThrowingD1>
  | null = null

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => currentDb,
  }),
}))

const { recordAlertEvent, queryAlertEvents } = await import(
  './alert-history-store'
)

import type { AlertEventRecord } from './alert-history-store'

const event = (over: Partial<AlertEventRecord> = {}): AlertEventRecord => ({
  eventTime: '2026-07-01T12:00:00.000Z',
  hostId: 0,
  hostLabel: 'prod-ch',
  rule: 'disk-usage',
  severity: 'critical',
  prevSeverity: 'warning',
  decisionKind: 'escalated',
  delivered: true,
  error: null,
  value: 97.5,
  channel: 'slack',
  ...over,
})

beforeEach(() => {
  currentDb = makeFakeD1()
})

describe('alert-history-store', () => {
  test('recordAlertEvent then queryAlertEvents round-trips every field', async () => {
    await recordAlertEvent(event())

    const results = await queryAlertEvents({ hostId: 0 })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      hostId: 0,
      hostLabel: 'prod-ch',
      rule: 'disk-usage',
      severity: 'critical',
      prevSeverity: 'warning',
      decisionKind: 'escalated',
      delivered: true,
      error: null,
      value: 97.5,
      channel: 'slack',
    })
    expect(typeof results[0].id).toBe('string')
    expect(results[0].id?.length).toBeGreaterThan(0)
  })

  test('delivered=false round-trips with an error message', async () => {
    await recordAlertEvent(
      event({ delivered: false, error: 'Webhook returned status 500' })
    )

    const [row] = await queryAlertEvents({ hostId: 0 })
    expect(row.delivered).toBe(false)
    expect(row.error).toBe('Webhook returned status 500')
  })

  test('queryAlertEvents filters by hostId', async () => {
    await recordAlertEvent(event({ hostId: 0, rule: 'host-0-rule' }))
    await recordAlertEvent(event({ hostId: 1, rule: 'host-1-rule' }))

    expect((await queryAlertEvents({ hostId: 0 })).map((r) => r.rule)).toEqual([
      'host-0-rule',
    ])
    expect((await queryAlertEvents({ hostId: 1 })).map((r) => r.rule)).toEqual([
      'host-1-rule',
    ])
  })

  test('queryAlertEvents filters by day (event_time date prefix)', async () => {
    await recordAlertEvent(
      event({ rule: 'day-1', eventTime: '2026-07-01T08:00:00.000Z' })
    )
    await recordAlertEvent(
      event({ rule: 'day-2', eventTime: '2026-07-02T08:00:00.000Z' })
    )

    const results = await queryAlertEvents({ day: '2026-07-01' })
    expect(results.map((r) => r.rule)).toEqual(['day-1'])
  })

  test('queryAlertEvents combines hostId + day filters', async () => {
    await recordAlertEvent(
      event({ hostId: 0, rule: 'match', eventTime: '2026-07-01T08:00:00.000Z' })
    )
    await recordAlertEvent(
      event({
        hostId: 1,
        rule: 'wrong-host',
        eventTime: '2026-07-01T08:00:00.000Z',
      })
    )
    await recordAlertEvent(
      event({
        hostId: 0,
        rule: 'wrong-day',
        eventTime: '2026-07-02T08:00:00.000Z',
      })
    )

    const results = await queryAlertEvents({ hostId: 0, day: '2026-07-01' })
    expect(results.map((r) => r.rule)).toEqual(['match'])
  })

  test('queryAlertEvents orders newest first and honours limit', async () => {
    await recordAlertEvent(
      event({ rule: 'oldest', eventTime: '2026-07-01T08:00:00.000Z' })
    )
    await recordAlertEvent(
      event({ rule: 'newest', eventTime: '2026-07-03T08:00:00.000Z' })
    )
    await recordAlertEvent(
      event({ rule: 'middle', eventTime: '2026-07-02T08:00:00.000Z' })
    )

    const all = await queryAlertEvents({ hostId: 0 })
    expect(all.map((r) => r.rule)).toEqual(['newest', 'middle', 'oldest'])

    const capped = await queryAlertEvents({ hostId: 0, limit: 1 })
    expect(capped.map((r) => r.rule)).toEqual(['newest'])
  })

  test('queryAlertEvents clamps an out-of-range limit to the max cap', async () => {
    for (let i = 0; i < 5; i++) {
      await recordAlertEvent(event({ rule: `r${i}` }))
    }
    // A limit above the hard cap must not blow past it (defense in depth —
    // the route also validates, but the store enforces its own ceiling).
    const results = await queryAlertEvents({ hostId: 0, limit: 100_000 })
    expect(results.length).toBe(5)
  })

  test('degrades to void/[] (never throws) when no D1 binding is present', async () => {
    currentDb = null

    await recordAlertEvent(event()) // must resolve without throwing
    expect(await queryAlertEvents({ hostId: 0 })).toEqual([])
  })

  test('degrades to void/[] (never throws) when the D1 call itself throws', async () => {
    currentDb = makeThrowingD1()

    await recordAlertEvent(event()) // must resolve without throwing
    expect(await queryAlertEvents({ hostId: 0 })).toEqual([])
  })
})
