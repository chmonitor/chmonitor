import { collectPeerDBSignals } from './alert-collector'
import {
  createPeerSlotBackoff,
  PEER_BACKOFF_BASE_MS,
  PEER_BACKOFF_CAP_MS,
  PEER_BACKOFF_THRESHOLD,
  peerSlotBackoff,
} from './peer-slot-backoff'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from 'bun:test'

describe('createPeerSlotBackoff', () => {
  test('opens a window only at the third consecutive failure', () => {
    let t = 1_000
    const b = createPeerSlotBackoff(() => t)
    expect(b.recordFailure('p').backoffStarted).toBe(false)
    expect(b.shouldSkip('p')).toBe(false)
    expect(b.recordFailure('p').backoffStarted).toBe(false)
    expect(b.shouldSkip('p')).toBe(false)
    const third = b.recordFailure('p')
    expect(third.backoffStarted).toBe(true)
    expect(third.windowMs).toBe(PEER_BACKOFF_BASE_MS)
    expect(b.shouldSkip('p')).toBe(true)
    t += PEER_BACKOFF_BASE_MS - 1
    expect(b.shouldSkip('p')).toBe(true)
    t += 1
    expect(b.shouldSkip('p')).toBe(false)
  })

  test('window doubles per failed probe up to the cap', () => {
    const b = createPeerSlotBackoff(() => 0)
    const windows: number[] = []
    for (let i = 0; i < 8; i++) windows.push(b.recordFailure('p').windowMs)
    const m = PEER_BACKOFF_BASE_MS
    expect(windows.slice(PEER_BACKOFF_THRESHOLD - 1)).toEqual([
      m,
      m * 2,
      m * 4,
      PEER_BACKOFF_CAP_MS,
      PEER_BACKOFF_CAP_MS,
      PEER_BACKOFF_CAP_MS,
    ])
  })

  test('success clears the failure count and any window', () => {
    const b = createPeerSlotBackoff(() => 0)
    for (let i = 0; i < 3; i++) b.recordFailure('p')
    expect(b.shouldSkip('p')).toBe(true)
    b.recordSuccess('p')
    expect(b.shouldSkip('p')).toBe(false)
    // Back to square one: two more failures do not reopen a window.
    expect(b.recordFailure('p').backoffStarted).toBe(false)
    expect(b.recordFailure('p').backoffStarted).toBe(false)
  })

  test('tracked peers are bounded, dropping the least recently failed', () => {
    const b = createPeerSlotBackoff(() => 0, { maxPeers: 3 })
    for (const p of ['a', 'b', 'c', 'd']) {
      for (let i = 0; i < 3; i++) b.recordFailure(p)
    }
    expect(b.size()).toBe(3)
    expect(b.shouldSkip('a')).toBe(false)
    expect(b.shouldSkip('d')).toBe(true)
  })
})

// Through the real default reader + peerdbFetch, so the fetch mock call count
// is what proves the dead peer stops being asked.
describe('defaultReader slot back-off', () => {
  const URL = 'http://flow-api:8113'
  const T0 = Date.parse('2026-01-01T00:00:00Z')
  let origUrl: string | undefined
  let origTtl: string | undefined
  let origFetch: typeof globalThis.fetch
  let slotCalls: number
  let slotMode: 'refused' | 'timeout' | 'bad-request' | 'ok'

  beforeEach(() => {
    origUrl = process.env.PEERDB_API_URL
    origTtl = process.env.PEERDB_CACHE_TTL_MS
    origFetch = globalThis.fetch
    process.env.PEERDB_API_URL = URL
    process.env.PEERDB_CACHE_TTL_MS = '0'
    peerSlotBackoff.reset()
    setSystemTime(new Date(T0))
    slotCalls = 0
    slotMode = 'refused'
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = String(input).slice(URL.length)
      if (path === '/v1/mirrors/list') {
        return new Response(
          JSON.stringify({ mirrors: [{ name: 'm', sourceName: 'pg-a' }] }),
          { status: 200 }
        )
      }
      if (path === '/v1/peers/list') {
        return new Response(
          JSON.stringify({ sourceItems: [{ name: 'pg-a' }] }),
          { status: 200 }
        )
      }
      if (path === '/v1/peers/slots/pg-a') {
        slotCalls++
        if (slotMode === 'refused') {
          throw new TypeError('fetch failed', {
            cause: Object.assign(new Error('refused'), {
              code: 'ECONNREFUSED',
            }),
          })
        }
        if (slotMode === 'timeout') {
          throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        }
        if (slotMode === 'bad-request') {
          return new Response('unsupported operation', { status: 400 })
        }
        return new Response(JSON.stringify({ slotData: [{ lagInMb: 9 }] }), {
          status: 200,
        })
      }
      return new Response('{}', { status: 200 })
    }) as typeof globalThis.fetch
  })
  afterEach(() => {
    setSystemTime()
    peerSlotBackoff.reset()
    globalThis.fetch = origFetch
    if (origUrl === undefined) delete process.env.PEERDB_API_URL
    else process.env.PEERDB_API_URL = origUrl
    if (origTtl === undefined) delete process.env.PEERDB_CACHE_TTL_MS
    else process.env.PEERDB_CACHE_TTL_MS = origTtl
  })

  const sweep = () => collectPeerDBSignals(undefined)

  test('three consecutive timeouts, then the peer is skipped', async () => {
    slotMode = 'timeout'
    for (let i = 0; i < 3; i++) await sweep()
    expect(slotCalls).toBe(3)
    await sweep()
    await sweep()
    expect(slotCalls).toBe(3)
  })

  test('connection refused backs off the same way', async () => {
    for (let i = 0; i < 5; i++) await sweep()
    expect(slotCalls).toBe(3)
  })

  test('a skipped peer is unknown (null slot lag), never healthy', async () => {
    for (let i = 0; i < 3; i++) await sweep()
    const out = await sweep()
    expect(slotCalls).toBe(3)
    expect(out.signals).toHaveLength(1)
    expect(out.signals[0]!.slotLagMb).toBeNull()
  })

  test('the window expiring retries once, and a failed probe backs off longer', async () => {
    for (let i = 0; i < 3; i++) await sweep()
    setSystemTime(new Date(T0 + PEER_BACKOFF_BASE_MS - 1))
    await sweep()
    expect(slotCalls).toBe(3)
    setSystemTime(new Date(T0 + PEER_BACKOFF_BASE_MS))
    await sweep()
    expect(slotCalls).toBe(4)
    // Probe failed: next window is 2x, so +5 min later is still skipped.
    setSystemTime(new Date(T0 + 2 * PEER_BACKOFF_BASE_MS))
    await sweep()
    expect(slotCalls).toBe(4)
  })

  test('a successful probe resets, and slot lag is read again', async () => {
    for (let i = 0; i < 3; i++) await sweep()
    slotMode = 'ok'
    setSystemTime(new Date(T0 + PEER_BACKOFF_BASE_MS))
    const out = await sweep()
    expect(slotCalls).toBe(4)
    expect(out.signals[0]!.slotLagMb).toBe(9)
    await sweep()
    expect(slotCalls).toBe(5)
    // Counter was cleared: two fresh failures do not skip.
    slotMode = 'refused'
    await sweep()
    await sweep()
    await sweep()
    expect(slotCalls).toBe(8)
  })

  test('400 responses never trigger back-off', async () => {
    slotMode = 'bad-request'
    for (let i = 0; i < 6; i++) await sweep()
    expect(slotCalls).toBe(6)
  })

  test('failures interleaved with a success never reach the threshold', async () => {
    await sweep()
    await sweep()
    slotMode = 'ok'
    await sweep()
    slotMode = 'refused'
    await sweep()
    await sweep()
    expect(slotCalls).toBe(5)
    await sweep()
    expect(slotCalls).toBe(6)
  })
})
