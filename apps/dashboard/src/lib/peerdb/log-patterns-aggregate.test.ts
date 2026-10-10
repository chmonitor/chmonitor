import type { MirrorLog } from './types'

import {
  collectFleetLogPatterns,
  logWindowMs,
  parseLogWindow,
} from './log-patterns-aggregate'
import { describe, expect, test } from 'bun:test'

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0)
const parseTs = (v: string | number | undefined) =>
  typeof v === 'number' ? v : null

const log = (msg: string, ageMs: number, type = 'error'): MirrorLog => ({
  errorMessage: msg,
  errorType: type,
  errorTimestamp: NOW - ageMs,
})

const base = {
  parseTs,
  now: NOW,
  window: '24h' as const,
  concurrency: 4,
  budgetMs: 5_000,
}

describe('parseLogWindow', () => {
  test('accepts the three windows and falls back to 24h', () => {
    expect(parseLogWindow('1h')).toBe('1h')
    expect(parseLogWindow('7d')).toBe('7d')
    expect(parseLogWindow('30d')).toBe('24h')
    expect(parseLogWindow(null)).toBe('24h')
  })
})

describe('collectFleetLogPatterns', () => {
  test('keeps lines written while the reads are in flight', async () => {
    // Regression: the window used to end when the call started, so a line
    // stamped during the fetch (or by a PeerDB clock slightly ahead) was dropped
    // and a live fleet could report zero lines.
    const out = await collectFleetLogPatterns({
      parseTs,
      window: '1h',
      concurrency: 2,
      budgetMs: 5_000,
      mirrors: ['m1', 'm2'],
      fetchLogs: async () => {
        await new Promise((r) => setTimeout(r, 5))
        return [
          {
            errorMessage: 'fresh',
            errorType: 'error',
            errorTimestamp: Date.now() + 2_000,
          },
        ]
      },
    })
    expect(out.entries).toHaveLength(2)
  })

  test('never has more upstream calls in flight than the pool width', async () => {
    // Protects the PeerDB catalog: the old client fan-out hit every mirror at once.
    let inFlight = 0
    let peak = 0
    const mirrors = Array.from({ length: 30 }, (_, i) => `m${i}`)
    const out = await collectFleetLogPatterns({
      ...base,
      mirrors,
      concurrency: 3,
      fetchLogs: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 2))
        inFlight--
        return [log('boom', 1000)]
      },
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(out.mirrorsRead).toBe(30)
    expect(out.mirrorsTotal).toBe(30)
    expect(out.partial).toBe(false)
    // Reads past the old 25-mirror client cap.
    expect(out.patterns[0].mirrors.length).toBe(30)
  })

  test('a failing mirror is reported as partial coverage, not dropped silently', async () => {
    const out = await collectFleetLogPatterns({
      ...base,
      mirrors: ['ok', 'bad'],
      fetchLogs: async (m) => {
        if (m === 'bad') throw new Error('502')
        return [log('x', 10)]
      },
    })
    expect(out).toMatchObject({
      mirrorsRead: 1,
      mirrorsTotal: 2,
      partial: true,
    })
  })

  test('mirrors the budget never reached count as unread', async () => {
    const out = await collectFleetLogPatterns({
      ...base,
      mirrors: ['a', 'b', 'c'],
      concurrency: 1,
      budgetMs: 1,
      fetchLogs: async () => {
        await new Promise((r) => setTimeout(r, 20))
        return []
      },
    })
    expect(out.mirrorsRead).toBeLessThan(3)
    expect(out.partial).toBe(true)
  })

  test('keeps only lines inside the window', async () => {
    const fetchLogs = async (): Promise<MirrorLog[]> => [
      log('recent', 30 * 60_000),
      log('yesterday', 20 * 3_600_000),
      log('last week', 6 * 86_400_000),
      log('ancient', 30 * 86_400_000),
      { errorMessage: 'no ts', errorType: 'error' },
    ]
    const msgs = async (window: '1h' | '24h' | '7d') =>
      (
        await collectFleetLogPatterns({
          ...base,
          window,
          mirrors: ['m'],
          fetchLogs,
        })
      ).entries.map((e) => e.message)

    expect(await msgs('1h')).toEqual(['recent'])
    expect(await msgs('24h')).toEqual(['recent', 'yesterday'])
    expect(await msgs('7d')).toEqual(['recent', 'yesterday', 'last week'])
    expect(logWindowMs('1h')).toBe(3_600_000)
  })

  test('flags a mirror whose full page is still inside the window', async () => {
    const out = await collectFleetLogPatterns({
      ...base,
      perMirror: 2,
      mirrors: ['busy', 'quiet'],
      fetchLogs: async (m) =>
        m === 'busy'
          ? [log('a', 10), log('a', 20)]
          : [log('a', 10), log('a', 2 * 86_400_000)],
    })
    expect(out.mirrorsTruncated).toBe(1)
  })

  test('groups repeats across mirrors into one pattern without shipping entries twice', async () => {
    const out = await collectFleetLogPatterns({
      ...base,
      mirrors: ['m1', 'm2'],
      fetchLogs: async (m) => [
        log(`sync failed for batch ${m === 'm1' ? 1 : 2}`, 5),
      ],
    })
    expect(out.patterns).toHaveLength(1)
    expect(out.patterns[0]).toMatchObject({ count: 2, level: 'error' })
    expect(out.patterns[0]).not.toHaveProperty('entries')
    expect(out.entries).toHaveLength(2)
  })
})
