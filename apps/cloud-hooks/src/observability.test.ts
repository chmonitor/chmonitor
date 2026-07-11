/**
 * Fingerprint hashing, tolerant event extraction, and aggregation for the
 * Cloudflare Worker exception scan.
 */

import {
  aggregateExceptions,
  computeFingerprint,
  extractEvent,
  extractEvents,
  fetchWorkerExceptions,
  fnv1a,
  type RawExceptionEvent,
} from './observability'
import { describe, expect, mock, test } from 'bun:test'

describe('fingerprinting', () => {
  test('fnv1a is stable and 8-hex', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'))
    expect(fnv1a('hello')).toMatch(/^[0-9a-f]{8}$/)
    expect(fnv1a('a')).not.toBe(fnv1a('b'))
  })

  test('per-invocation ids collapse to one fingerprint', () => {
    const a = computeFingerprint(
      'Cannot read row 12345 at 0xdeadbeef',
      'chmonitor-dash'
    )
    const b = computeFingerprint(
      'Cannot read row 99 at 0xcafef00d',
      'chmonitor-dash'
    )
    expect(a).toBe(b)
  })

  test('different script → different fingerprint', () => {
    expect(computeFingerprint('boom', 'a')).not.toBe(
      computeFingerprint('boom', 'b')
    )
  })
})

describe('extractEvent — tolerant shapes', () => {
  test('$metadata/$workers envelope', () => {
    const ev = extractEvent({
      $metadata: { error: 'TypeError: x is undefined' },
      $workers: { scriptName: 'chmonitor-dash' },
      timestamp: 1_700_000_000_000,
    })
    expect(ev).toMatchObject({
      message: 'TypeError: x is undefined',
      script: 'chmonitor-dash',
      timestamp: 1_700_000_000_000,
    })
  })

  test('flat record + seconds timestamp is scaled to ms', () => {
    const ev = extractEvent({
      message: 'boom',
      scriptName: 'chmonitor-hooks',
      timestamp: 1_700_000_000,
    })
    expect(ev?.timestamp).toBe(1_700_000_000_000)
  })

  test('no message → null', () => {
    expect(extractEvent({ $workers: { scriptName: 'x' } })).toBeNull()
    expect(extractEvent(null)).toBeNull()
  })
})

describe('extractEvents — walks response shapes', () => {
  test('result.events.events', () => {
    expect(
      extractEvents({ result: { events: { events: [{ a: 1 }] } } })
    ).toHaveLength(1)
  })
  test('top-level events', () => {
    expect(extractEvents({ events: [{ a: 1 }, { b: 2 }] })).toHaveLength(2)
  })
  test('missing → empty', () => {
    expect(extractEvents({})).toEqual([])
    expect(extractEvents(null)).toEqual([])
  })
})

describe('aggregateExceptions', () => {
  test('groups by fingerprint with count + first/last seen', () => {
    const events: RawExceptionEvent[] = [
      { message: 'boom 1', script: 'dash', timestamp: 100 },
      { message: 'boom 2', script: 'dash', timestamp: 300 },
      { message: 'other', script: 'dash', timestamp: 200 },
    ]
    const out = aggregateExceptions(events)
    expect(out).toHaveLength(2)
    const boom = out.find((e) => e.message.startsWith('boom'))
    expect(boom).toMatchObject({ count: 2, firstSeen: 100, lastSeen: 300 })
  })
})

describe('fetchWorkerExceptions — never throws', () => {
  const cfg = { accountId: 'acc', apiToken: 'tok', scripts: ['dash'] }

  test('parses a telemetry response into fingerprints', async () => {
    const fetchImpl = mock(
      async () =>
        new Response(
          JSON.stringify({
            result: {
              events: {
                events: [
                  {
                    $metadata: { error: 'Error: kaboom' },
                    $workers: { scriptName: 'dash' },
                    timestamp: 1000,
                  },
                ],
              },
            },
          }),
          { status: 200 }
        )
    )
    const out = await fetchWorkerExceptions(cfg, fetchImpl, () => {})
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ message: 'Error: kaboom', script: 'dash' })
  })

  test('non-2xx → []', async () => {
    const fetchImpl = mock(async () => new Response('nope', { status: 403 }))
    expect(await fetchWorkerExceptions(cfg, fetchImpl, () => {})).toEqual([])
  })

  test('network error → []', async () => {
    const fetchImpl = mock(async () => {
      throw new Error('dns')
    })
    expect(await fetchWorkerExceptions(cfg, fetchImpl, () => {})).toEqual([])
  })
})
