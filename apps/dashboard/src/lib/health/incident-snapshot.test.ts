/**
 * Tests for captureIncidentSnapshot.
 *
 * `readOnlyQuery` (the only external I/O) is stubbed via mock.module so we
 * exercise the snapshot's shape and its partial-failure resilience without
 * hitting ClickHouse. The stub routes by which system table the SQL references,
 * so each sub-collector can be made to succeed or fail independently.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

// ── Stub external I/O before importing the module under test. ─────────────

type QueryHandler = (sql: string) => unknown

let handler: QueryHandler = () => []

const realModule = { ...(await import('../ai/agent/tools/helpers')) }

mock.module('../ai/agent/tools/helpers', () => ({
  ...realModule,
  readOnlyQuery: async ({ query }: { query: string }) => handler(query),
}))

// Restore the real modules so these mocks never leak into other test files.
afterAll(() => {
  mock.module('../ai/agent/tools/helpers', () => ({ ...realModule }))
})

// ── Import AFTER the mock is registered. ──────────────────────────────────

import { captureIncidentSnapshot } from './incident-snapshot'

/** Route a query to the right fixture by the system table it selects from. */
function routeBy(
  sql: string
): 'processes' | 'merges' | 'memory' | 'disks' | 'replicas' | 'unknown' {
  if (sql.includes('system.processes')) return 'processes'
  if (sql.includes('system.merges')) return 'merges'
  if (sql.includes('system.disks')) return 'disks'
  if (sql.includes('system.replicas')) return 'replicas'
  if (sql.includes('asynchronous_metrics')) return 'memory'
  return 'unknown'
}

beforeEach(() => {
  handler = () => []
})

describe('captureIncidentSnapshot', () => {
  test('returns a fully-populated snapshot when every query succeeds', async () => {
    handler = (sql) => {
      switch (routeBy(sql)) {
        case 'processes':
          return [
            {
              query_id: 'q1',
              user: 'default',
              elapsed: 12.5,
              memory_mb: 256.4,
              query: 'SELECT * FROM big_table',
            },
          ]
        case 'merges':
          return [{ active: 3, stuck: 1, max_elapsed: 900.2 }]
        case 'memory':
          return [{ value: 72.1 }]
        case 'disks':
          return [{ value: 88.5 }]
        case 'replicas':
          return [{ value: 42 }]
        default:
          return []
      }
    }

    const snap = await captureIncidentSnapshot(0)

    expect(snap.hostId).toBe(0)
    expect(typeof snap.capturedAt).toBe('string')
    expect(snap.topQueries).toEqual([
      {
        queryId: 'q1',
        user: 'default',
        elapsed: 12.5,
        memoryMb: 256.4,
        query: 'SELECT * FROM big_table',
      },
    ])
    expect(snap.merges).toEqual({ active: 3, stuck: 1, maxElapsed: 900.2 })
    expect(snap.memoryUsagePct).toBe(72.1)
    expect(snap.diskUsagePct).toBe(88.5)
    expect(snap.replicationLagSeconds).toBe(42)
  })

  test('threads hostId through to the snapshot', async () => {
    const snap = await captureIncidentSnapshot(7)
    expect(snap.hostId).toBe(7)
  })

  test('returns a partial snapshot when some sub-collectors fail', async () => {
    // processes + disks throw; the rest resolve.
    handler = (sql) => {
      const kind = routeBy(sql)
      if (kind === 'processes' || kind === 'disks') {
        throw new Error('table not found')
      }
      if (kind === 'merges') return [{ active: 0, stuck: 0, max_elapsed: null }]
      if (kind === 'memory') return [{ value: 10 }]
      if (kind === 'replicas') return [{ value: 0 }]
      return []
    }

    const snap = await captureIncidentSnapshot(1)

    // Failed collectors → null; successful ones still populate.
    expect(snap.topQueries).toBeNull()
    expect(snap.diskUsagePct).toBeNull()
    expect(snap.merges).toEqual({ active: 0, stuck: 0, maxElapsed: null })
    expect(snap.memoryUsagePct).toBe(10)
    expect(snap.replicationLagSeconds).toBe(0)
  })

  test('never throws even when every query fails', async () => {
    handler = () => {
      throw new Error('cluster unreachable')
    }

    const snap = await captureIncidentSnapshot(2)

    expect(snap.hostId).toBe(2)
    expect(snap.topQueries).toBeNull()
    expect(snap.merges).toBeNull()
    expect(snap.memoryUsagePct).toBeNull()
    expect(snap.diskUsagePct).toBeNull()
    expect(snap.replicationLagSeconds).toBeNull()
  })

  test('coerces string cells and handles empty result rows', async () => {
    handler = (sql) => {
      const kind = routeBy(sql)
      if (kind === 'processes') {
        return [
          {
            query_id: 'q9',
            user: 'reader',
            elapsed: '3.5', // string from JSON
            memory_mb: '128',
            query: 'OPTIMIZE TABLE t',
          },
        ]
      }
      if (kind === 'merges') return [] // empty rows → defaults
      return [{ value: null }] // null value → null
    }

    const snap = await captureIncidentSnapshot(0)

    expect(snap.topQueries?.[0]).toEqual({
      queryId: 'q9',
      user: 'reader',
      elapsed: 3.5,
      memoryMb: 128,
      query: 'OPTIMIZE TABLE t',
    })
    expect(snap.merges).toEqual({ active: 0, stuck: 0, maxElapsed: null })
    expect(snap.memoryUsagePct).toBeNull()
  })
})
