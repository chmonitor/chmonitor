import type { PeerDBAlertSnapshotReader } from './alert-collector'

import { collectPeerDBSignals } from './alert-collector'
import { afterEach, describe, expect, test } from 'bun:test'

function stubReader(
  overrides: Partial<PeerDBAlertSnapshotReader> = {}
): PeerDBAlertSnapshotReader {
  return {
    listMirrors: async () => [],
    mirrorStatus: async () => null,
    mirrorErrorCount: async () => ({ count: 0, source: 'log-api' }),
    peerSlots: async () => [],
    listSourcePeers: async () => [],
    ...overrides,
  }
}

describe('collectPeerDBSignals', () => {
  test('empty when no mirrors listed', async () => {
    const out = await collectPeerDBSignals(stubReader())
    expect(out.signals).toEqual([])
    expect(out.metrics.mirrorsChecked).toBe(0)
  })

  test('builds a signal from status + error count + slot lag via sourceName', async () => {
    const out = await collectPeerDBSignals(
      stubReader({
        listMirrors: async () => [
          { name: 'pg_to_ch', sourceName: 'pg', status: 'STATUS_RUNNING' },
        ],
        mirrorStatus: async () => ({
          currentFlowState: 'STATUS_RUNNING',
          lagSec: 45,
        }),
        mirrorErrorCount: async () => ({ count: 2, source: 'log-api' }),
        listSourcePeers: async () => ['pg'],
        peerSlots: async () => [{ slotName: 's', lagInMb: 12 }],
      })
    )
    expect(out.signals).toHaveLength(1)
    const s = out.signals[0]!
    expect(s.flowName).toBe('pg_to_ch')
    expect(s.status).toBe('STATUS_RUNNING')
    expect(s.lagSec).toBe(45)
    expect(s.recentErrorCount).toBe(2)
    expect(s.errorCountSource).toBe('log-api')
    expect(s.slotLagMb).toBe(12)
    expect(out.metrics.hasLagSample).toBe(true)
    expect(out.metrics.hasErrorSample).toBe(true)
    expect(out.metrics.hasSlotSample).toBe(true)
    expect(out.fleetMaxSlotLagMb).toBe(12)
  })

  test('unavailable error source is preserved, never coerced to zero-ok', async () => {
    const out = await collectPeerDBSignals(
      stubReader({
        listMirrors: async () => [{ name: 'm' }],
        mirrorErrorCount: async () => ({ count: 0, source: 'unavailable' }),
      })
    )
    expect(out.signals[0]!.errorCountSource).toBe('unavailable')
    expect(out.metrics.hasErrorSample).toBe(false)
  })

  test('marks snapshot stalled only when clones are pending', async () => {
    const reader = (done: boolean) =>
      stubReader({
        listMirrors: async () => [{ name: 'm' }],
        mirrorStatus: async () => ({
          currentFlowState: 'STATUS_SNAPSHOT',
          cdcStatus: {
            snapshotStatus: {
              clones: [
                {
                  tableName: 't',
                  fetchCompleted: done,
                  consolidateCompleted: done,
                },
              ],
            },
          },
        }),
      })
    expect(
      (await collectPeerDBSignals(reader(false))).signals[0]!.snapshotStalled
    ).toBe(true)
    expect(
      (await collectPeerDBSignals(reader(true))).signals[0]!.snapshotStalled
    ).toBe(false)
  })

  test('never throws on a totally failing reader', async () => {
    const failing: PeerDBAlertSnapshotReader = {
      listMirrors: async () => {
        throw new Error('down')
      },
      mirrorStatus: async () => {
        throw new Error('down')
      },
      mirrorErrorCount: async () => {
        throw new Error('down')
      },
      peerSlots: async () => {
        throw new Error('down')
      },
      listSourcePeers: async () => {
        throw new Error('down')
      },
    }
    const out = await collectPeerDBSignals(failing)
    expect(out.signals).toEqual([])
  })

  test('one bad mirror does not block the rest', async () => {
    const out = await collectPeerDBSignals(
      stubReader({
        listMirrors: async () => [{ name: 'good' }, { name: 'bad' }],
        mirrorStatus: async (name) => {
          if (name === 'bad') throw new Error('boom')
          return { currentFlowState: 'STATUS_RUNNING' }
        },
      })
    )
    expect(out.signals).toHaveLength(2)
    expect(out.metrics.errored).toBe(1)
  })

  test('caps collection at 50 mirrors', async () => {
    const names = Array.from({ length: 60 }, (_, i) => ({ name: `m${i}` }))
    const out = await collectPeerDBSignals(
      stubReader({ listMirrors: async () => names })
    )
    expect(out.metrics.mirrorsChecked).toBe(50)
    expect(out.signals).toHaveLength(50)
  })
})

describe('defaultReader via mocked peerdbFetch', () => {
  const URL = 'http://flow-api:8113'
  let origUrl: string | undefined
  let origPassword: string | undefined
  let origScheme: string | undefined
  let origFetch: typeof globalThis.fetch

  const responses: Record<string, unknown> = {
    '/v1/mirrors/list': {
      mirrors: [{ name: 'alert-cycle-e2e', sourceName: 'pg-src' }],
    },
    '/v1/peers/list': { sourceItems: [{ name: 'pg-src' }] },
  }

  afterEach(() => {
    globalThis.fetch = origFetch
    if (origUrl === undefined) delete process.env.PEERDB_API_URL
    else process.env.PEERDB_API_URL = origUrl
    if (origPassword === undefined) delete process.env.PEERDB_PASSWORD
    else process.env.PEERDB_PASSWORD = origPassword
    if (origScheme === undefined) delete process.env.PEERDB_AUTH_SCHEME
    else process.env.PEERDB_AUTH_SCHEME = origScheme
  })

  test('reads status, shared-contract logs envelope, and slots', async () => {
    origUrl = process.env.PEERDB_API_URL
    origPassword = process.env.PEERDB_PASSWORD
    origScheme = process.env.PEERDB_AUTH_SCHEME
    origFetch = globalThis.fetch
    process.env.PEERDB_API_URL = URL
    process.env.PEERDB_PASSWORD = 'alert-token'
    process.env.PEERDB_AUTH_SCHEME = 'bearer'
    const seenAuth: string[] = []
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      seenAuth.push(headers.Authorization ?? '')
      const url = String(input)
      const path = url.slice(URL.length)
      if (path === '/v1/mirrors/status') {
        return new Response(
          JSON.stringify({
            currentFlowState: 'STATUS_RUNNING',
            lagSec: 61,
          }),
          { status: 200 }
        )
      }
      if (path === '/v1/mirrors/logs') {
        // Error-lane envelope alias `{logs}` + mixed levels: only ERROR counts.
        // The shared mirror-logs contract owns casing/aliases (#3409).
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<
          string,
          unknown
        >
        expect(body.level).toBe('ERROR')
        return new Response(
          JSON.stringify({
            logs: [
              { message: 'wal reader crashed', level: 'ERROR' },
              { message: 'all good', level: 'INFO' },
            ],
          }),
          { status: 200 }
        )
      }
      if (path === '/v1/peers/slots/pg-src') {
        return new Response(JSON.stringify({ slotData: [{ lagInMb: 7 }] }), {
          status: 200,
        })
      }
      const hit = responses[path]
      if (hit !== undefined) {
        return new Response(JSON.stringify(hit), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    }) as typeof globalThis.fetch

    // Reach the default reader by omitting the injected reader.
    const out = await collectPeerDBSignals(undefined)
    expect(out.signals).toHaveLength(1)
    const s = out.signals[0]!
    expect(s.flowName).toBe('alert-cycle-e2e')
    expect(s.lagSec).toBe(61)
    expect(s.recentErrorCount).toBe(1)
    expect(s.errorCountSource).toBe('log-api')
    expect(seenAuth.length).toBeGreaterThan(0)
    expect(seenAuth.every((auth) => auth === 'Bearer alert-token')).toBe(true)
    expect(s.slotLagMb).toBe(7)
  })
})
