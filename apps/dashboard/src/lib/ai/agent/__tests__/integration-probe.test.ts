/**
 * The reachability probe must never block the chat and never re-probe on
 * every request (#3674): results are cached per isolate (success TTL, shorter
 * failure TTL), concurrent callers share one probe, and a probe slower than
 * the budget answers `probe_timeout` while still filling the cache when it
 * settles. Probe errors are reduced to a kind so no URL or DSN escapes.
 */

import {
  createIntegrationProbeCache,
  probeFailureKind,
} from '../integration-probe'
import { describe, expect, test } from 'bun:test'
import { PeerDBError } from '@/lib/peerdb/peerdb-config'

function manualTimers() {
  const timers: { fn: () => void; ms: number; live: boolean }[] = []
  return {
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms, live: true }
      timers.push(t)
      return () => {
        t.live = false
      }
    },
    fireAll() {
      for (const t of timers) if (t.live) t.fn()
    },
    pending: () => timers.filter((t) => t.live).length,
  }
}

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(peerdb: () => Promise<unknown>) {
  let clock = 1_000
  const timers = manualTimers()
  let calls = 0
  const cache = createIntegrationProbeCache({
    probes: {
      peerdb: () => {
        calls++
        return peerdb()
      },
      postgres: async () => {},
    },
    now: () => clock,
    ttlMs: () => 60_000,
    timeoutMs: () => 1500,
    setTimer: timers.setTimer,
  })
  return {
    cache,
    timers,
    calls: () => calls,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('integration probe cache', () => {
  test('reuses a success until the TTL expires', async () => {
    const t = setup(async () => {})
    expect(await t.cache.check('peerdb')).toEqual({ ok: true })
    t.advance(59_000)
    expect(await t.cache.check('peerdb')).toEqual({ ok: true })
    expect(t.calls()).toBe(1)
    t.advance(2_000)
    await t.cache.check('peerdb')
    expect(t.calls()).toBe(2)
  })

  test('caches a failure for the shorter failure TTL (15s)', async () => {
    const t = setup(async () => {
      throw new PeerDBError('down', 502, 'refused')
    })
    expect(await t.cache.check('peerdb')).toEqual({
      ok: false,
      kind: 'refused',
    })
    t.advance(14_000)
    await t.cache.check('peerdb')
    expect(t.calls()).toBe(1)
    t.advance(2_000)
    await t.cache.check('peerdb')
    expect(t.calls()).toBe(2)
  })

  test('concurrent callers share one in-flight probe', async () => {
    const d = deferred()
    const t = setup(() => d.promise)
    const a = t.cache.check('peerdb')
    const b = t.cache.check('peerdb')
    d.resolve()
    expect(await Promise.all([a, b])).toEqual([{ ok: true }, { ok: true }])
    expect(t.calls()).toBe(1)
  })

  test('a slow probe answers probe_timeout without waiting, then fills the cache', async () => {
    const d = deferred()
    const t = setup(() => d.promise)
    const pending = t.cache.check('peerdb')
    // Budget elapses while the probe is still running.
    t.timers.fireAll()
    expect(await pending).toEqual({ ok: false, kind: 'probe_timeout' })

    // The probe was raced, not aborted: it settles in the background…
    d.resolve()
    await d.promise
    await Promise.resolve()
    await Promise.resolve()
    // …and the next conversation gets the real result without probing again.
    expect(await t.cache.check('peerdb')).toEqual({ ok: true })
    expect(t.calls()).toBe(1)
  })

  test('a probe that never settles is replaced after the max in-flight age', async () => {
    let n = 0
    const never = new Promise<void>(() => {})
    const t = setup(() => (++n === 1 ? never : Promise.resolve()))
    const first = t.cache.check('peerdb')
    t.timers.fireAll()
    expect(await first).toEqual({ ok: false, kind: 'probe_timeout' })
    // Still within the max age: the stuck probe is shared, not restarted.
    const second = t.cache.check('peerdb')
    t.timers.fireAll()
    await second
    expect(t.calls()).toBe(1)
    // Past the max age: a fresh probe runs and answers.
    t.advance(16_000)
    expect(await t.cache.check('peerdb')).toEqual({ ok: true })
    expect(t.calls()).toBe(2)
  })

  test('the budget timer is cancelled when the probe answers first', async () => {
    const t = setup(async () => {})
    await t.cache.check('peerdb')
    expect(t.timers.pending()).toBe(0)
  })
})

describe('probe errors are redacted to a kind', () => {
  test('a PeerDB error keeps only its failure kind', async () => {
    const secret = 'http://admin:hunter2@peerdb.internal:8113'
    const t = setup(async () => {
      throw new PeerDBError(`Failed to reach ${secret}`, 502, 'dns')
    })
    const r = await t.cache.check('peerdb')
    expect(r).toEqual({ ok: false, kind: 'dns' })
    expect(JSON.stringify(r)).not.toContain('hunter2')
  })

  test('a Postgres-style error keeps only its code', () => {
    const err = Object.assign(
      new Error('connect to postgres://u:pw@db:5432/x failed'),
      { code: '28P01' }
    )
    expect(probeFailureKind(err)).toBe('28p01')
  })

  test('an error with no code or with a junk code is just "error"', () => {
    expect(probeFailureKind(new Error('postgres://u:pw@db/x'))).toBe('error')
    expect(probeFailureKind({ code: 'postgres://u:pw@db/x' })).toBe('error')
  })
})
