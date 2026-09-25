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
    const err = candidates.find((c) => c.metric === 'peerdb_mirror_errors')
    expect(err?.severity).toBe('critical')
    expect(err?.value).toBe(12)
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
      candidates.find((c) => c.metric === 'peerdb_snapshot_stalled')?.value
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
      listSourcePeers: async () => {
        throw new Error('boom')
      },
    }
    expect(await collectPeerDBInsights(hostile)).toEqual([])
  })
})
