/**
 * Unit tests for the agent's PeerDB mirror-status tool.
 *
 * These tests stub `globalThis.fetch` (the only I/O `peerdbRequest` does)
 * with canned PeerDB payloads and point `PEERDB_API_URL` at a dummy host, so
 * they exercise the REAL helper + tool path hermetically: fleet sort order,
 * caps/truncation, mirror-config stripping, name validation, best-effort
 * enrichment, and the not-configured fail-closed branch.
 *
 * Only `server-only` is mocked (pulled in via `./helpers` →
 * `@chm/clickhouse-client`); nothing else is stubbed, so this file does not
 * leak incomplete module mocks into other suites.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('server-only', () => ({}))

const { createPeerDBTools } = await import('../peerdb-tools')

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
