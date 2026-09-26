/**
 * Unit tests for the PeerDB insight collectors against an injected stub
 * snapshot reader — no PeerDB / store I/O. Covers the fleet-level findings,
 * the empty-fleet silence, and the never-throw contract.
 */

import {
  collectPeerDBInsights,
  type PeerDBSnapshotReader,
} from './peerdb-collectors'
import { describe, expect, test } from 'bun:test'

function stubReader(
  overrides: Partial<PeerDBSnapshotReader> = {}
): PeerDBSnapshotReader {
  return {
    listMirrors: async () => [],
    mirrorStatus: async () => null,
    mirrorErrorCount: async () => 0,
    peerSlots: async () => [],
    peerSlotLagHistory: async () => [],
    listSourcePeers: async () => [],
    ...overrides,
  }
}

describe('collectPeerDBInsights', () => {
  test('silent on an empty fleet', async () => {
    expect(await collectPeerDBInsights(stubReader())).toEqual([])
  })

  test('failed + paused + lag findings for an unhealthy fleet', async () => {
    const candidates = await collectPeerDBInsights(
      stubReader({
        listMirrors: async () => [
          { name: 'bad', status: 'STATUS_FAILED', isCdc: true },
          { name: 'held', status: 'STATUS_PAUSED', isCdc: false },
          { name: 'good', status: 'STATUS_RUNNING', isCdc: true },
        ],
        listSourcePeers: async () => ['pg'],
        peerSlots: async () => [{ slotName: 's', lagInMb: 3000 }],
      })
    )
    const metrics = candidates.map((c) => c.metric)
    expect(metrics).toContain('peerdb_failed_mirrors')
    expect(metrics).toContain('peerdb_paused_mirrors')
    expect(metrics).toContain('peerdb_slot_lag_mb')
    // Critical first.
    expect(candidates[0]?.severity).toBe('critical')
    // All PeerDB-prefixed.
    for (const c of candidates) {
      expect(c.metric?.startsWith('peerdb_')).toBe(true)
      expect(c.title.startsWith('PeerDB:')).toBe(true)
    }
  })

  test('error-volume finding for a noisy mirror', async () => {
    const candidates = await collectPeerDBInsights(
      stubReader({
        listMirrors: async () => [{ name: 'noisy', status: 'STATUS_RUNNING' }],
        mirrorErrorCount: async () => 12,
      })
    )
    // Per-mirror identity rides in the metric, so the fleet dedup keeps it.
    const err = candidates.find(
      (c) => c.metric === 'peerdb_mirror_errors:noisy'
    )
    expect(err?.severity).toBe('critical')
    expect(err?.value).toBe(12)
  })

  test('terminated mirrors are surfaced, unlike before (#3439)', async () => {
    const candidates = await collectPeerDBInsights(
      stubReader({
        listMirrors: async () => [
          { name: 'gone', status: 'STATUS_TERMINATED' },
          { name: 'good', status: 'STATUS_RUNNING' },
        ],
      })
    )
    const term = candidates.find(
      (c) => c.metric === 'peerdb_terminated_mirrors'
    )
    expect(term?.severity).toBe('warning')
    expect(term?.value).toBe(1)
  })

  test('lag divergence fires from history even below the absolute threshold', async () => {
    const candidates = await collectPeerDBInsights(
      stubReader({
        listMirrors: async () => [{ name: 'pg', status: 'STATUS_RUNNING' }],
        listSourcePeers: async () => ['pg'],
        // 400 MiB: below SLOT_LAG_WARN_MB (512), so no absolute-lag card…
        peerSlots: async () => [{ slotName: 's', lagInMb: 400 }],
        // …but climbing by 200 MiB across the window.
        peerSlotLagHistory: async () => [200, 260, 330, 400],
      })
    )
    expect(candidates.some((c) => c.metric === 'peerdb_slot_lag_mb')).toBe(
      false
    )
    const trend = candidates.find((c) => c.metric === 'peerdb_slot_lag_trend')
    expect(trend?.severity).toBe('warning')
    expect(trend?.value).toBe(200)
  })

  test('an unreachable lag history does not suppress the absolute-lag card', async () => {
    const candidates = await collectPeerDBInsights(
      stubReader({
        listMirrors: async () => [{ name: 'pg', status: 'STATUS_RUNNING' }],
        listSourcePeers: async () => ['pg'],
        peerSlots: async () => [{ slotName: 's', lagInMb: 9000 }],
        peerSlotLagHistory: async () => {
          throw new Error('lag_history unavailable')
        },
      })
    )
    expect(candidates.some((c) => c.metric === 'peerdb_slot_lag_mb')).toBe(true)
    expect(candidates.some((c) => c.metric === 'peerdb_slot_lag_trend')).toBe(
      false
    )
  })

  test('snapshot-stall finding from clone summaries', async () => {
    const candidates = await collectPeerDBInsights(
      stubReader({
        listMirrors: async () => [{ name: 'snap', status: 'STATUS_SNAPSHOT' }],
        mirrorStatus: async () => ({
          currentFlowState: 'STATUS_SNAPSHOT',
          cdcStatus: {
            snapshotStatus: {
              clones: [
                {
                  tableName: 't1',
                  fetchCompleted: true,
                  consolidateCompleted: true,
                },
                { tableName: 't2' },
              ],
            },
          },
        }),
      })
    )
    expect(
      candidates.find((c) => c.metric === 'peerdb_snapshot_stalled:snap')?.value
    ).toBe(1)
  })

  test('never throws on a hostile reader', async () => {
    const hostile: PeerDBSnapshotReader = {
      listMirrors: async () => {
        throw new Error('boom')
      },
      mirrorStatus: async () => {
        throw new Error('boom')
      },
      mirrorErrorCount: async () => {
        throw new Error('boom')
      },
      peerSlots: async () => {
        throw new Error('boom')
      },
      peerSlotLagHistory: async () => {
        throw new Error('boom')
      },
      listSourcePeers: async () => {
        throw new Error('boom')
      },
    }
    expect(await collectPeerDBInsights(hostile)).toEqual([])
  })
})

describe('collectPeerDBInsights default reader (env config + auth parity)', () => {
  const SAVED_API_URL = process.env.PEERDB_API_URL
  const SAVED_PASSWORD = process.env.PEERDB_PASSWORD
  const SAVED_SCHEME = process.env.PEERDB_AUTH_SCHEME
  const realFetch = globalThis.fetch

  let seenAuth: (string | null)[]
  let fetchCalls: number

  function mockUpstream() {
    seenAuth = []
    fetchCalls = 0
    globalThis.fetch = (async (url: unknown, init?: { headers?: unknown }) => {
      fetchCalls += 1
      const headers = (init?.headers ?? {}) as Record<string, string>
      seenAuth.push(headers.Authorization ?? null)
      const u = String(url)
      if (u.endsWith('/v1/mirrors/list')) {
        return Response.json({
          mirrors: [{ name: 'm', status: 'STATUS_FAILED', isCdc: true }],
        })
      }
      if (u.endsWith('/v1/peers/list'))
        return Response.json({ sourceItems: [] })
      if (u.endsWith('/v1/mirrors/status')) {
        return Response.json({ currentFlowState: 'STATUS_FAILED' })
      }
      if (u.includes('/v1/mirrors/total_rows_synced/')) {
        return Response.json({ totalRowsSynced: 1 })
      }
      return Response.json({ errors: [] })
    }) as typeof fetch
  }

  function restoreEnv() {
    if (SAVED_API_URL === undefined) delete process.env.PEERDB_API_URL
    else process.env.PEERDB_API_URL = SAVED_API_URL
    if (SAVED_PASSWORD === undefined) delete process.env.PEERDB_PASSWORD
    else process.env.PEERDB_PASSWORD = SAVED_PASSWORD
    if (SAVED_SCHEME === undefined) delete process.env.PEERDB_AUTH_SCHEME
    else process.env.PEERDB_AUTH_SCHEME = SAVED_SCHEME
    globalThis.fetch = realFetch
  }

  test('unconfigured PeerDB collects nothing and never fetches', async () => {
    delete process.env.PEERDB_API_URL
    mockUpstream()
    try {
      expect(await collectPeerDBInsights()).toEqual([])
      expect(fetchCalls).toBe(0)
    } finally {
      restoreEnv()
    }
  })

  test('basic (default) sends empty-user Basic auth', async () => {
    process.env.PEERDB_API_URL = 'http://peerdb:8113'
    process.env.PEERDB_PASSWORD = 's3cret'
    delete process.env.PEERDB_AUTH_SCHEME
    mockUpstream()
    try {
      const out = await collectPeerDBInsights()
      expect(
        out.find((c) => c.metric === 'peerdb_failed_mirrors')
      ).toBeDefined()
      expect(fetchCalls).toBeGreaterThan(0)
      expect(seenAuth[0]).toBe(`Basic ${btoa(':s3cret')}`)
    } finally {
      restoreEnv()
    }
  })

  test('bearer deployments collect with a Bearer header (parity)', async () => {
    process.env.PEERDB_API_URL = 'http://peerdb:8113'
    process.env.PEERDB_PASSWORD = 'tok-123'
    process.env.PEERDB_AUTH_SCHEME = 'bearer'
    mockUpstream()
    try {
      const out = await collectPeerDBInsights()
      expect(
        out.find((c) => c.metric === 'peerdb_failed_mirrors')
      ).toBeDefined()
      expect(seenAuth[0]).toBe('Bearer tok-123')
    } finally {
      restoreEnv()
    }
  })

  test('unreachable flow-api degrades to [] without throwing', async () => {
    process.env.PEERDB_API_URL = 'http://127.0.0.1:9'
    delete process.env.PEERDB_PASSWORD
    delete process.env.PEERDB_AUTH_SCHEME
    globalThis.fetch = realFetch
    try {
      expect(await collectPeerDBInsights()).toEqual([])
    } finally {
      restoreEnv()
    }
  })
})
