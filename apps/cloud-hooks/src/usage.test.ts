/**
 * Usage metrics — window arithmetic, graceful degradation, and the digest block.
 */

import type { TelemetryStats } from './usage'

import {
  collectUsage,
  fetchUsageStats,
  formatActiveLine,
  referenceDayFor,
  shiftDay,
  stickiness,
  TELEMETRY_STATS_URL,
  usageLines,
  utcDay,
} from './usage'
import { describe, expect, test } from 'bun:test'

/** 2026-07-24T06:00:00Z — a mid-morning run, so "yesterday" is 2026-07-23. */
const NOW = Math.floor(Date.parse('2026-07-24T06:00:00Z') / 1000)

/** A stats payload shaped like the service's response, ending on 2026-07-23. */
function statsBody(overrides: Record<string, unknown> = {}) {
  return {
    project: 'chmonitor',
    days: 30,
    generated_at: '2026-07-24T06:00:00.000Z',
    summary: {
      dau: 10,
      wau: 40,
      mau: 120,
      events: 5000,
      today: { users: 3, events: 20 },
    },
    series: [
      { day: '2026-07-22', dau: 9, events: 100 },
      { day: '2026-07-23', dau: 10, events: 120 },
    ],
    dims: { event: { ping: [120, 4000] } },
    ...overrides,
  }
}

function jsonFetch(
  body: unknown,
  init: ResponseInit = {},
  seen: Array<{ url: string; init?: RequestInit }> = []
): typeof fetch {
  return (async (url: string, reqInit?: RequestInit) => {
    seen.push({ url, init: reqInit })
    return new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      ...init,
    })
  }) as unknown as typeof fetch
}

describe('day arithmetic', () => {
  test('utcDay formats a Date as the telemetry day key', () => {
    expect(utcDay(new Date('2026-07-23T23:59:59Z'))).toBe('2026-07-23')
  })

  test('shiftDay walks backwards across a month boundary', () => {
    expect(shiftDay('2026-07-01', -1)).toBe('2026-06-30')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })

  test('a 7-day window is the reference day minus 6, inclusive', () => {
    // Reference day INCLUDED in the window, so -6 gives 7 distinct days.
    expect(shiftDay('2026-07-23', -6)).toBe('2026-07-17')
    expect(shiftDay('2026-07-23', -29)).toBe('2026-06-24')
  })
})

describe('stickiness', () => {
  test('is DAU/MAU as a percentage with one decimal', () => {
    expect(stickiness({ dau: 25, wau: 60, mau: 100 })).toBe(25)
    expect(stickiness({ dau: 1, wau: 2, mau: 3 })).toBe(33.3)
  })

  test('is null (not 0%) when there is no monthly base to divide by', () => {
    expect(stickiness({ dau: 0, wau: 0, mau: 0 })).toBeNull()
  })
})

describe('fetchUsageStats', () => {
  test('GETs the shared service stats API for 30 days', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = []
    const stats = await fetchUsageStats(jsonFetch(statsBody(), {}, seen))
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe(`${TELEMETRY_STATS_URL}?days=30`)
    expect(TELEMETRY_STATS_URL).toBe(
      'https://telemetry.anyr.workers.dev/api/chmonitor/stats'
    )
    // A hung stats API must not stall the digest: the request is bounded.
    expect(seen[0].init?.signal).toBeInstanceOf(AbortSignal)
    expect(stats?.summary).toEqual({ dau: 10, wau: 40, mau: 120 })
    expect(stats?.series).toEqual([
      { day: '2026-07-22', dau: 9 },
      { day: '2026-07-23', dau: 10 },
    ])
  })

  test('logs once and returns null on an HTTP error', async () => {
    const logged: string[] = []
    const stats = await fetchUsageStats(jsonFetch({}, { status: 503 }), (m) =>
      logged.push(m)
    )
    expect(stats).toBeNull()
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain('HTTP 503')
  })

  test('logs once and returns null when the fetch itself throws', async () => {
    const logged: string[] = []
    const boom = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await fetchUsageStats(boom, (m) => logged.push(m))).toBeNull()
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain('fetch failed')
  })

  test('rejects a response without the fields the digest relies on', async () => {
    const logged: string[] = []
    const noSummary = statsBody({ summary: undefined })
    expect(
      await fetchUsageStats(jsonFetch(noSummary), (m) => logged.push(m))
    ).toBeNull()
    const badSeries = statsBody({ series: [{ day: '2026-07-23' }] })
    expect(
      await fetchUsageStats(jsonFetch(badSeries), (m) => logged.push(m))
    ).toBeNull()
    expect(logged).toHaveLength(2)
    expect(logged[0]).toContain('unexpected shape')
  })

  test('the default logger reports the failure instead of calling itself', () => {
    // No logger argument — this is how index.ts calls it, so the default
    // logger is the one that runs in production. It has to run out-of-process:
    // a default that refers to its own parameter, `(m, meta) => logError(m, meta)`,
    // is a *tail* call, so JSC turns it into a loop rather than a stack
    // overflow. It never throws, never returns and blocks the event loop, so a
    // hard kill is the only bound.
    const probe = `
const usage = await import('./usage.ts')
const boom = async () => { throw new Error('offline') }
let lines = []
const real = console.error
console.error = (...args) => { lines.push(String(args[0])) }
const stats = await usage.fetchUsageStats(boom)
console.error = real
console.log(JSON.stringify({ stats, lines }))
`
    const child = Bun.spawnSync([process.execPath, '-e', probe], {
      cwd: import.meta.dir,
      // ~40x headroom over a healthy call, and inside the test timeout so the
      // kill always fires first and a regression reads as this assertion.
      timeout: 3_000,
    })
    expect({
      killed: child.signalCode ?? null,
      exitCode: child.exitCode,
      stderr: new TextDecoder().decode(child.stderr).slice(0, 200),
    }).toEqual({ killed: null, exitCode: 0, stderr: '' })

    const { stats, lines } = JSON.parse(
      new TextDecoder().decode(child.stdout)
    ) as { stats: unknown; lines: string[] }
    expect(stats).toBeNull()
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0])
    expect(entry.level).toBe('error')
    expect(entry.msg).toContain('telemetry stats fetch failed')
    expect(entry.err.message).toBe('offline')
  }, 15_000)
})

describe('collectUsage', () => {
  const stats = (series: TelemetryStats['series']): TelemetryStats => ({
    summary: { dau: 10, wau: 40, mau: 120 },
    series,
  })

  test('measures from YESTERDAY, not today', () => {
    expect(referenceDayFor(NOW)).toBe('2026-07-23')
    const usage = collectUsage(stats([{ day: '2026-07-23', dau: 10 }]), NOW)
    expect(usage?.referenceDay).toBe('2026-07-23')
  })

  test('maps summary dau/wau/mau onto the active counts', () => {
    const usage = collectUsage(stats([{ day: '2026-07-23', dau: 10 }]), NOW)
    expect(usage?.active).toEqual({ dau: 10, wau: 40, mau: 120 })
  })

  test('is null when the stats are unavailable, so the digest omits the section', () => {
    expect(collectUsage(null, NOW)).toBeNull()
    expect(collectUsage(undefined, NOW)).toBeNull()
  })

  test('refuses numbers that do not cover yesterday rather than mislabel them', () => {
    // Stats ending the day before yesterday (a stale cache, or a clock skew)
    // would otherwise be printed under yesterday's date.
    const logged: string[] = []
    const usage = collectUsage(
      stats([{ day: '2026-07-22', dau: 9 }]),
      NOW,
      (m) => logged.push(m)
    )
    expect(usage).toBeNull()
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain('2026-07-23')
  })
})

describe('digest block', () => {
  test('labels the numbers as installs, with the measured day', () => {
    const lines = usageLines({
      referenceDay: '2026-07-23',
      active: { dau: 10, wau: 40, mau: 120 },
    })
    const text = lines.join('\n')
    // "installs" is not cosmetic: telemetry has no user identity, so calling
    // these users would misreport the metric.
    expect(text).toContain('installs, 2026-07-23')
    expect(text).toContain('DAU 10 · WAU 40 · MAU 120')
  })

  test('is empty when usage is unavailable so the caller can spread it', () => {
    expect(usageLines(null)).toEqual([])
  })

  test('omits stickiness when there is no monthly base', () => {
    expect(formatActiveLine('CLI', { dau: 0, wau: 0, mau: 0 })).not.toContain(
      'stickiness'
    )
  })
})
