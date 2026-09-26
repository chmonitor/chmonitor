/**
 * Unit tests for the agent's PeerDB tools.
 *
 * These tests stub `globalThis.fetch` (the only I/O `peerdbRequest` does)
 * with canned PeerDB payloads and point `PEERDB_API_URL` at a dummy host, so
 * they exercise the REAL helper + tool path hermetically: fleet sort order,
 * caps/truncation, mirror/peer-config stripping, name validation, best-effort
 * enrichment, and the not-configured fail-closed branch.
 *
 * `get_peerdb_mirror_status` covers fleet + per-mirror detail.
 * `get_peerdb_metrics` covers the `fleet` / `slots` / `slot_lag_history` /
 * `rows_synced` / `snapshot` / `peer_stats` metric surfaces: the fleet
 * aggregate, slot-lag classification and trend verdicts, CDC throughput,
 * initial-load progress, and per-peer queries.
 *
 * Only `server-only` is mocked (pulled in via `./helpers` →
 * `@chm/clickhouse-client`); nothing else is stubbed, so this file does not
 * leak incomplete module mocks into other suites.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('server-only', () => ({}))

const { createPeerDBTools, PEERDB_SERIES_LIMIT } = await import(
  '../peerdb-tools'
)

const originalFetch = globalThis.fetch
const originalApiUrl = process.env.PEERDB_API_URL

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  process.env.PEERDB_API_URL = 'http://peerdb.test'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalApiUrl === undefined) {
    delete process.env.PEERDB_API_URL
  } else {
    process.env.PEERDB_API_URL = originalApiUrl
  }
})

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  globalThis.fetch = mock(async (url: unknown, init?: RequestInit) => {
    return handler(String(url), init)
  }) as unknown as typeof fetch
}

describe('get_peerdb_mirror_status — fleet mode', () => {
  test('sorts worst-first: failed > non-running > running by lag desc', async () => {
    stubFetch((url, init) => {
      if (url.endsWith('/v1/mirrors/list')) {
        return jsonResponse({
          mirrors: [
            { name: 'ok_fast', status: 'STATUS_RUNNING', isCdc: true },
            { name: 'failed_job', status: 'STATUS_RUNNING', isCdc: true },
            { name: 'paused_job', status: 'STATUS_RUNNING', isCdc: true },
            { name: 'ok_slow', status: 'STATUS_RUNNING', isCdc: true },
          ],
        })
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        flowJobName: string
      }
      const byName: Record<string, unknown> = {
        ok_fast: { currentFlowState: 'STATUS_RUNNING', lagSec: 1.5 },
        failed_job: {
          currentFlowState: 'STATUS_FAILED',
          errorMessage: 'boom',
        },
        paused_job: { currentFlowState: 'STATUS_PAUSED', lagSec: 99 },
        ok_slow: { currentFlowState: 'STATUS_RUNNING', lagSec: 42 },
      }
      return jsonResponse(byName[body.flowJobName] ?? {})
    })

    const tools = createPeerDBTools() as any
    const result = await tools.get_peerdb_mirror_status.execute({})
    expect(result.mode).toBe('fleet')
    expect(result.mirrors.map((m: { name: string }) => m.name)).toEqual([
      'failed_job',
      'paused_job',
      'ok_slow',
      'ok_fast',
    ])
    expect(result.mirrors[0].error).toBe('boom')
  })

  test('keeps a mirror listed with a status_error when its status fetch fails', async () => {
    stubFetch((url) => {
      if (url.endsWith('/v1/mirrors/list')) {
        return jsonResponse({ mirrors: [{ name: 'flaky' }] })
      }
      return jsonResponse({ error: 'nope' }, 500)
    })

    const tools = createPeerDBTools() as any
    const result = await tools.get_peerdb_mirror_status.execute({})
    expect(result.mirrors).toHaveLength(1)
    expect(result.mirrors[0].name).toBe('flaky')
    expect(result.mirrors[0].status_error).toBeString()
  })

  test('fails closed with a not-configured message when PEERDB_API_URL is unset', async () => {
    delete process.env.PEERDB_API_URL
    const tools = createPeerDBTools() as any
    const err = await tools.get_peerdb_mirror_status.execute({}).then(
      () => null,
      (e: Error) => e
    )
    expect(err).not.toBeNull()
    expect(String(err?.message)).toContain('not configured')
  })
})

describe('get_peerdb_mirror_status — detail mode', () => {
  function detailStub() {
    stubFetch((url, init) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as { flowJobName?: string })
        : {}
      if (url.endsWith('/v1/mirrors/status')) {
        return jsonResponse({
          flowJobName: body.flowJobName,
          currentFlowState: 'STATUS_RUNNING',
          lagSec: 3.2,
          cdcStatus: {
            rowsSynced: 100,
            config: { password: 'super-secret', host: 'db.internal' },
          },
          qrepStatus: undefined,
        })
      }
      if (url.includes('/total_rows_synced/')) {
        return jsonResponse({ totalCount: 18_412_603 })
      }
      if (url.includes('/table_total_counts/')) {
        return jsonResponse({
          tablesData: [
            {
              tableName: 'public.orders',
              counts: {
                totalCount: 10,
                insertsCount: 8,
                updatesCount: 1,
                deletesCount: 1,
              },
            },
          ],
        })
      }
      if (url.endsWith('/v1/mirrors/cdc/batches')) {
        return jsonResponse({
          cdcBatches: [{ batchId: 'b1', numRows: 500 }],
        })
      }
      if (url.endsWith('/v1/mirrors/logs')) {
        return jsonResponse({
          errors: [{ errorMessage: 'x'.repeat(500), errorType: 'cdc' }],
        })
      }
      return jsonResponse({}, 404)
    })
  }

  test('returns detail with authoritative rows-synced and stripped configs', async () => {
    detailStub()
    const tools = createPeerDBTools() as any
    const result = await tools.get_peerdb_mirror_status.execute({
      mirrorName: 'orders_cdc',
    })
    expect(result.mode).toBe('detail')
    expect(result.state).toBe('STATUS_RUNNING')
    expect(result.rows_synced).toBe(18_412_603)
    expect(result.tables).toEqual([
      { table: 'public.orders', total: 10, inserts: 8, updates: 1, deletes: 1 },
    ])
    expect(result.recent_batches).toHaveLength(1)
    // Error preview capped at 300 chars + ellipsis.
    expect(result.recent_errors[0].message).toHaveLength(301)
    // No connector secrets cross into the model result.
    expect(JSON.stringify(result)).not.toContain('super-secret')
    expect(JSON.stringify(result)).not.toContain('cdcStatus')
  })

  test('tolerates missing enrichment endpoints (older PeerDB / QRep)', async () => {
    stubFetch((url, init) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as { flowJobName?: string })
        : {}
      if (url.endsWith('/v1/mirrors/status')) {
        return jsonResponse({
          flowJobName: body.flowJobName,
          currentFlowState: 'STATUS_SNAPSHOT',
          qrepStatus: { partitions: [{ partitionId: 'p1' }] },
        })
      }
      return jsonResponse({ error: 'not found' }, 404)
    })
    const tools = createPeerDBTools() as any
    const result = await tools.get_peerdb_mirror_status.execute({
      mirrorName: 'events_snapshot',
    })
    expect(result.state).toBe('STATUS_SNAPSHOT')
    expect(result.is_cdc).toBe(false)
    expect(result.qrep_partitions).toBe(1)
    expect(result.tables).toEqual([])
  })

  test('rejects a mirror name that could escape the path segment', async () => {
    const tools = createPeerDBTools() as any
    const err = await tools.get_peerdb_mirror_status
      .execute({ mirrorName: '../../admin' })
      .then(
        () => null,
        (e: Error) => e
      )
    expect(err).not.toBeNull()
    expect(String(err?.message)).toContain('plain mirror identifier')
  })

  test('sends the request with an Authorization header shape, never the secret in the URL', async () => {
    process.env.PEERDB_PASSWORD = 's3cret'
    const seen: string[] = []
    globalThis.fetch = mock(async (url: unknown, init?: RequestInit) => {
      seen.push(String(url))
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toStartWith('Basic ')
      return jsonResponse({ mirrors: [] })
    }) as unknown as typeof fetch
    try {
      const tools = createPeerDBTools() as any
      await tools.get_peerdb_mirror_status.execute({})
      expect(seen[0]).not.toContain('s3cret')
    } finally {
      delete process.env.PEERDB_PASSWORD
    }
  })
})

// ---------------------------------------------------------------------------
// get_peerdb_metrics — the slot-lag / throughput / snapshot / fleet surface.
// ---------------------------------------------------------------------------

/** Peers with one healthy and one badly-lagging slot each. */
function slotStub(
  extra?: (url: string, init?: RequestInit) => Response | null
) {
  stubFetch((url, init) => {
    const hit = extra?.(url, init)
    if (hit) return hit
    if (url.endsWith('/v1/peers/list')) {
      return jsonResponse({ sourceItems: [{ name: 'pg-src' }] })
    }
    if (url.endsWith('/v1/peers/slots/pg-src')) {
      return jsonResponse({
        slotData: [
          {
            slotName: 'peer_slot',
            lagInMb: 4096,
            active: true,
            walStatus: 'reserved',
          },
          { slotName: 'healthy_slot', lagInMb: 12, active: true },
        ],
      })
    }
    return jsonResponse({}, 404)
  })
}

describe('get_peerdb_metrics — fleet mode', () => {
  test('aggregates fleet state, worst slot lag, and total rows synced', async () => {
    slotStub((url, init) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as { flowJobName?: string })
        : {}
      if (url.endsWith('/v1/mirrors/list')) {
        return jsonResponse({
          mirrors: [
            { name: 'orders', status: 'STATUS_RUNNING', isCdc: true },
            { name: 'events', status: 'STATUS_FAILED', isCdc: false },
          ],
        })
      }
      if (url.endsWith('/v1/mirrors/status')) {
        return jsonResponse({
          flowJobName: body.flowJobName,
          currentFlowState:
            body.flowJobName === 'events' ? 'STATUS_FAILED' : 'STATUS_RUNNING',
        })
      }
      if (url.includes('/total_rows_synced/')) {
        return jsonResponse({ totalCount: 1000 })
      }
      return null
    })

    const tools = createPeerDBTools() as any
    const result = await tools.get_peerdb_metrics.execute({})
    expect(result.mode).toBe('fleet')
    expect(result.total_mirrors).toBe(2)
    expect(result.cdc_mirrors).toBe(1)
    expect(result.qrep_mirrors).toBe(1)
    expect(result.by_status).toEqual({ running: 1, failed: 1 })
    expect(result.failed_mirrors).toEqual(['events'])
    expect(result.total_rows_synced).toBe(2000)
    // Worst slot wins, labeled `<peer>/<slot>`.
    expect(result.worst_slot_lag_mb).toBe(4096)
    expect(result.worst_slot_label).toBe('pg-src/peer_slot')
    // Worst-first ordering in the slot table.
    expect(result.worst_slots[0].slot).toBe('peer_slot')
    expect(result.worst_slots[0].health).toBe('critical')
    expect(result.worst_slots[1].health).toBe('ok')
  })

  test('degrades to partial rather than failing when a fan-out endpoint is missing', async () => {
    slotStub((url) => {
      if (url.endsWith('/v1/mirrors/list')) {
        return jsonResponse({
          mirrors: [{ name: 'orders', status: 'STATUS_RUNNING', isCdc: true }],
        })
      }
      // total_rows_synced + status unavailable.
      return null
    })

    const tools = createPeerDBTools() as any
    const result = await tools.get_peerdb_metrics.execute({})
    expect(result.partial).toBe(true)
    expect(result.total_mirrors).toBe(1)
  })

  test('fails closed with a not-configured message when PEERDB_API_URL is unset', async () => {
    delete process.env.PEERDB_API_URL
    const tools = createPeerDBTools() as any
    const err = await tools.get_peerdb_metrics.execute({}).then(
      () => null,
      (e: Error) => e
    )
    expect(err).not.toBeNull()
    expect(String(err?.message)).toContain('not configured')
  })
})

describe('get_peerdb_metrics — slots', () => {
  test('returns per-peer slot health sorted worst-first and classified', async () => {
    slotStub()
    const tools = createPeerDBTools() as any
    const result = await tools.get_peerdb_metrics.execute({ metric: 'slots' })
    expect(result.mode).toBe('slots')
    expect(result.partial).toBe(false)
    expect(result.slots.map((s: { slot: string }) => s.slot)).toEqual([
      'peer_slot',
      'healthy_slot',
    ])
    expect(result.slots[0]).toMatchObject({
      peer: 'pg-src',
      lag_mb: 4096,
      active: true,
      wal_status: 'reserved',
    })
  })

  test('scopes to a single peer and still rejects a path-escaping peer name', async () => {
    const seen: string[] = []
    stubFetch((url) => {
      seen.push(url)
      return jsonResponse({ slotData: [{ slotName: 's1', lagInMb: 3 }] })
    })
    const tools = createPeerDBTools() as any
    const ok = await tools.get_peerdb_metrics.execute({
      metric: 'slots',
      peerName: 'pg-src',
    })
    expect(ok.slots).toHaveLength(1)
    // No peers/list fan-out for a scoped read.
    expect(seen.some((u) => u.endsWith('/v1/peers/list'))).toBe(false)
    expect(seen[0]).toEndWith('/v1/peers/slots/pg-src')

    const err = await tools.get_peerdb_metrics
      .execute({ metric: 'slots', peerName: '../../admin' })
      .then(
        () => null,
        (e: Error) => e
      )
    expect(err).not.toBeNull()
    expect(String(err?.message)).toContain('plain peer identifier')
  })

  test('reports a per-peer failure without losing the peers that answered', async () => {
    stubFetch((url) => {
      if (url.endsWith('/v1/peers/list')) {
        return jsonResponse({
          sourceItems: [{ name: 'pg-good' }, { name: 'pg-bad' }],
        })
      }
      if (url.endsWith('/v1/peers/slots/pg-bad')) {
        return jsonResponse({ error: 'boom' }, 500)
      }
      return jsonResponse({ slotData: [{ slotName: 's1', lagInMb: 1 }] })
    })
    const tools = createPeerDBTools() as any
    const result = await tools.get_peerdb_metrics.execute({ metric: 'slots' })
    expect(result.partial).toBe(true)
    expect(result.slots).toHaveLength(1)
    expect(result.failures[0].peer).toBe('pg-bad')
  })
})

describe('get_peerdb_metrics — slot_lag_history', () => {
  test('derives a growing/recovering/flat trend from the series', async () => {
    const cases: [number[], string][] = [
      [[100, 200, 900], 'growing'],
      [[900, 200, 100], 'recovering'],
      [[500, 520, 505], 'flat'],
    ]
    for (const [sizes, expected] of cases) {
      stubFetch(() =>
        jsonResponse({
          data: sizes.map((size, i) => ({
            time: `2026-01-01T00:0${i}:00Z`,
            size,
          })),
        })
      )
      const tools = createPeerDBTools() as any
      const result = await tools.get_peerdb_metrics.execute({
        metric: 'slot_lag_history',
        peerName: 'pg-src',
        slotName: 'peer_slot',
      })
      expect(result.trend).toBe(expected)
      expect(result.series).toHaveLength(sizes.length)
      expect(result.window).toBe('1day')
    }
  })

  test('passes window through and caps a long series', async () => {
    stubFetch(() =>
      jsonResponse({
        data: Array.from({ length: 500 }, (_, i) => ({
          time: `t${i}`,
          size: i,
        })),
      })
    )
    const tools = createPeerDBTools() as any
    const result = await tools.get_peerdb_metrics.execute({
      metric: 'slot_lag_history',
      peerName: 'pg-src',
      slotName: 'peer_slot',
      window: '7days',
    })
    expect(result.window).toBe('7days')
    expect(result.series).toHaveLength(PEERDB_SERIES_LIMIT)
    expect(result.truncated).toBe(true)
    expect(result.note).toContain(String(PEERDB_SERIES_LIMIT))
  })

  test('requires peerName and slotName', async () => {
    const tools = createPeerDBTools() as any
    const noPeer = await tools.get_peerdb_metrics
      .execute({ metric: 'slot_lag_history', slotName: 's' })
      .then(
        () => null,
        (e: Error) => e
      )
    expect(String(noPeer?.message)).toContain('requires `peerName`')

    const noSlot = await tools.get_peerdb_metrics
      .execute({ metric: 'slot_lag_history', peerName: 'pg-src' })
      .then(
        () => null,
        (e: Error) => e
      )
    expect(String(noSlot?.message)).toContain('requires `slotName`')
  })
})

describe('get_peerdb_metrics — rows_synced', () => {
  test('returns the CDC series with current and peak rows/sec', async () => {
    const seen: { url: string; body: unknown }[] = []
    stubFetch((url, init) => {
      seen.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return jsonResponse({
        totalRows: 5000,
        data: [
          { time: 'a', rows: 600 },
          { time: 'b', rows: 300 },
          { time: 'c', rows: 1200 },
        ],
      })
    })
    const tools = createPeerDBTools() as any
    const result = await tools.get_peerdb_metrics.execute({
      metric: 'rows_synced',
      mirrorName: 'orders_cdc',
    })
    expect(result.total_rows).toBe(5000)
    // Second-to-last bucket (the newest is still filling): 300 rows / 60s.
    expect(result.current_rows_per_sec).toBe(5)
    expect(result.peak_rows_per_sec).toBe(20)
    expect(result.series).toHaveLength(3)
    expect(seen[0].body).toEqual({
      flowJobName: 'orders_cdc',
      aggregateType: '1min',
    })
  })

  test('requires mirrorName and rejects a path-escaping mirror name', async () => {
    const tools = createPeerDBTools() as any
    const missing = await tools.get_peerdb_metrics
      .execute({ metric: 'rows_synced' })
      .then(
        () => null,
        (e: Error) => e
      )
    expect(String(missing?.message)).toContain('requires `mirrorName`')

    const escaping = await tools.get_peerdb_metrics
      .execute({ metric: 'rows_synced', mirrorName: '../admin' })
      .then(
        () => null,
        (e: Error) => e
      )
    expect(String(escaping?.message)).toContain('plain mirror identifier')
  })
})

describe('get_peerdb_metrics — snapshot', () => {
  test('summarizes initial-load progress per table and overall', async () => {
    stubFetch((url) => {
      if (url.endsWith('/v1/mirrors/cdc/initial_load/orders_snapshot')) {
        return jsonResponse({
          tableSummaries: [
            {
              tableName: 'public.orders',
              numPartitionsCompleted: 3,
              numPartitionsTotal: 4,
              numRowsSynced: 900,
              fetchCompleted: false,
            },
            {
              tableName: 'public.items',
              numPartitionsCompleted: 1,
              numPartitionsTotal: 1,
              numRowsSynced: 100,
              fetchCompleted: true,
            },
          ],
        })
      }
      return jsonResponse({}, 404)
    })
    const tools = createPeerDBTools() as any
    const result = await tools.get_peerdb_metrics.execute({
      metric: 'snapshot',
      mirrorName: 'orders_snapshot',
    })
    expect(result.tables_total).toBe(2)
    expect(result.partitions_completed).toBe(4)
    expect(result.partitions_total).toBe(5)
    expect(result.percent_complete).toBe(80)
    expect(result.rows_synced).toBe(1000)
    expect(result.tables[0]).toMatchObject({
      table: 'public.orders',
      partitions_completed: 3,
      partitions_total: 4,
    })
  })

  test('requires mirrorName', async () => {
    const tools = createPeerDBTools() as any
    const err = await tools.get_peerdb_metrics
      .execute({ metric: 'snapshot' })
      .then(
        () => null,
        (e: Error) => e
      )
    expect(String(err?.message)).toContain('requires `mirrorName`')
  })
})

describe('get_peerdb_metrics — peer_stats', () => {
  test('returns active queries with type/version and never the peer config', async () => {
    stubFetch((url) => {
      if (url.endsWith('/v1/peers/stats/pg-src')) {
        return jsonResponse({
          statData: [
            {
              pid: 42,
              state: 'active',
              waitEvent: 'PgXact',
              duration: 1200,
              query: 'SELECT '.padEnd(800, 'x'),
            },
          ],
        })
      }
      if (url.endsWith('/v1/peers/info/pg-src')) {
        return jsonResponse({
          version: 'v0.9.4',
          peer: {
            name: 'pg-src',
            type: 'POSTGRES',
            config: { password: 'peer-secret', host: 'db.internal' },
          },
        })
      }
      if (url.endsWith('/v1/peers/type/pg-src')) {
        return jsonResponse({ type: 'POSTGRES' })
      }
      return jsonResponse({}, 404)
    })
    const tools = createPeerDBTools() as any
    const result = await tools.get_peerdb_metrics.execute({
      metric: 'peer_stats',
      peerName: 'pg-src',
    })
    expect(result.peer_type).toBe('POSTGRES')
    expect(result.peerdb_version).toBe('v0.9.4')
    expect(result.active_queries).toHaveLength(1)
    expect(result.active_queries[0].duration).toBe(1200)
    // Query text is truncated to 500 chars + ellipsis.
    expect(result.active_queries[0].query).toHaveLength(501)
    // No connector secrets cross into the model result.
    expect(JSON.stringify(result)).not.toContain('peer-secret')
    expect(JSON.stringify(result)).not.toContain('config')
  })

  test('tolerates missing peer info/type endpoints', async () => {
    stubFetch((url) => {
      if (url.endsWith('/v1/peers/stats/pg-src')) {
        return jsonResponse({ statData: [] })
      }
      return jsonResponse({ error: 'not found' }, 404)
    })
    const tools = createPeerDBTools() as any
    const result = await tools.get_peerdb_metrics.execute({
      metric: 'peer_stats',
      peerName: 'pg-src',
    })
    expect(result.active_queries).toEqual([])
    expect(result.peerdb_version).toBeUndefined()
  })

  test('requires peerName', async () => {
    const tools = createPeerDBTools() as any
    const err = await tools.get_peerdb_metrics
      .execute({ metric: 'peer_stats' })
      .then(
        () => null,
        (e: Error) => e
      )
    expect(String(err?.message)).toContain('requires `peerName`')
  })
})
