/**
 * Unit tests for the PeerDB agent helpers: the name validators that guard what
 * reaches a URL / request body, the env-driven gate, and `peerdbRequest`'s
 * fail-closed behaviour. Only `globalThis.fetch` and env vars are stubbed.
 */

import {
  assertValidMirrorName,
  assertValidPeerName,
  assertValidSlotName,
  getPeerDBAgentConfig,
  isPeerDBAgentEnabled,
  PeerDBAgentError,
  peerdbRequest,
} from '../peerdb-helpers'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const ENV_KEYS = [
  'PEERDB_API_URL',
  'PEERDB_PASSWORD',
  'PEERDB_AUTH_SCHEME',
  'CHM_FEATURE_PEERDB_AGENT',
  'CHM_FEATURE_PEERDB_ENABLED',
] as const
const savedEnv: Record<string, string | undefined> = {}
const originalFetch = globalThis.fetch

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

const validators = [
  ['mirrorName', assertValidMirrorName],
  ['peerName', assertValidPeerName],
  ['slotName', assertValidSlotName],
] as const

describe.each(validators)('%s validation', (field, assertValid) => {
  test('accepts a plain identifier, including the 256-char limit', () => {
    expect(() => assertValid('orders_mirror-1.v2')).not.toThrow()
    expect(() => assertValid('a'.repeat(256))).not.toThrow()
  })

  test('rejects empty, over-long and non-string input, naming the field', () => {
    expect(() => assertValid('')).toThrow(`${field} must be a non-empty string`)
    expect(() => assertValid('a'.repeat(257))).toThrow(
      `${field} must be a non-empty string up to 256 chars`
    )
    expect(() => assertValid(undefined as unknown as string)).toThrow(field)
    expect(() => assertValid(42 as unknown as string)).toThrow(field)
  })

  test.each([
    ['a slash', 'a/b'],
    ['a path-traversal segment', '../admin'],
    ['a query delimiter', 'a?x=1'],
    ['a fragment delimiter', 'a#b'],
    ['a space', 'a b'],
    ['a newline', 'a\nb'],
    ['a NUL byte', 'a\u0000b'],
    ['DEL', 'a\u007fb'],
  ])('rejects %s so it cannot escape the path segment', (_label, bad) => {
    expect(() => assertValid(bad)).toThrow(`${field} must be a plain`)
  })
})

describe('getPeerDBAgentConfig', () => {
  test('is null when PEERDB_API_URL is unset or blank', () => {
    expect(getPeerDBAgentConfig()).toBeNull()
    process.env.PEERDB_API_URL = '   '
    expect(getPeerDBAgentConfig()).toBeNull()
  })

  test('reads the URL and password from env at call time', () => {
    process.env.PEERDB_API_URL = 'http://peerdb.test'
    process.env.PEERDB_PASSWORD = 'secret'
    expect(getPeerDBAgentConfig()).toMatchObject({
      baseUrl: 'http://peerdb.test',
      secret: 'secret',
    })
  })
})

describe('isPeerDBAgentEnabled', () => {
  const ctx = { cloud: false, signedIn: false, reachability: { ok: true } }

  test('is off when PeerDB is not configured, even when the probe passed', () => {
    expect(isPeerDBAgentEnabled(ctx as never)).toBe(false)
  })

  test('is on when configured and reachable', () => {
    process.env.PEERDB_API_URL = 'http://peerdb.test'
    expect(isPeerDBAgentEnabled(ctx as never)).toBe(true)
  })

  test('is off when configured but the probe has not run or failed', () => {
    process.env.PEERDB_API_URL = 'http://peerdb.test'
    expect(
      isPeerDBAgentEnabled({ cloud: false, signedIn: false } as never)
    ).toBe(false)
    expect(
      isPeerDBAgentEnabled({
        ...ctx,
        reachability: { ok: false, kind: 'refused' },
      } as never)
    ).toBe(false)
  })

  test('CHM_FEATURE_PEERDB_AGENT=false and CHM_FEATURE_PEERDB_ENABLED=false are kill switches', () => {
    process.env.PEERDB_API_URL = 'http://peerdb.test'
    process.env.CHM_FEATURE_PEERDB_AGENT = 'false'
    expect(isPeerDBAgentEnabled(ctx as never)).toBe(false)
    delete process.env.CHM_FEATURE_PEERDB_AGENT
    process.env.CHM_FEATURE_PEERDB_ENABLED = 'false'
    expect(isPeerDBAgentEnabled(ctx as never)).toBe(false)
  })

  test('an anonymous cloud visitor never gets the tools, even with the flag on', () => {
    process.env.PEERDB_API_URL = 'http://peerdb.test'
    process.env.CHM_FEATURE_PEERDB_AGENT = 'true'
    expect(
      isPeerDBAgentEnabled({ ...ctx, cloud: true, signedIn: false } as never)
    ).toBe(false)
    expect(
      isPeerDBAgentEnabled({ ...ctx, cloud: true, signedIn: true } as never)
    ).toBe(true)
  })
})

const rejection = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected peerdbRequest to reject')
    },
    (e: unknown) => e as PeerDBAgentError
  )

describe('peerdbRequest', () => {
  function stubFetch(handler: (url: string, init: RequestInit) => Response) {
    const fn = mock(async (url: unknown, init?: RequestInit) =>
      handler(String(url), init ?? {})
    )
    globalThis.fetch = fn as unknown as typeof fetch
    return fn
  }

  test('fails closed with a 503 PeerDBAgentError and never calls fetch when unconfigured', async () => {
    const fetchMock = stubFetch(() => new Response('{}'))
    const err = await rejection(peerdbRequest('/v1/flows/list'))
    expect(err).toBeInstanceOf(PeerDBAgentError)
    expect(err.status).toBe(503)
    expect(err.message).toContain('PEERDB_API_URL is unset')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('GET: joins base URL and path (adding a missing slash) and parses JSON', async () => {
    process.env.PEERDB_API_URL = 'http://peerdb.test/'
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })
    )
    expect(await peerdbRequest<{ ok: number }>('v1/peers/list')).toEqual({
      ok: 1,
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('http://peerdb.test/v1/peers/list')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })

  test('POST: sends the JSON body, and the credential only as a header', async () => {
    process.env.PEERDB_API_URL = 'http://peerdb.test'
    process.env.PEERDB_PASSWORD = 'hunter2'
    const fetchMock = stubFetch(() => new Response('{"rows":[]}'))
    await peerdbRequest('/v1/mirrors/slot_lag', {
      method: 'POST',
      body: { slotName: 's1' },
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ slotName: 's1' })
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBeDefined()
    expect(headers['Content-Type']).toBe('application/json')
    expect(url).not.toContain('hunter2')
    expect(init.body as string).not.toContain('hunter2')
  })

  test('PEERDB_AUTH_SCHEME=bearer sends the password as a Bearer token', async () => {
    process.env.PEERDB_API_URL = 'http://peerdb.test'
    process.env.PEERDB_PASSWORD = 'tok'
    process.env.PEERDB_AUTH_SCHEME = 'bearer'
    const fetchMock = stubFetch(() => new Response('{}'))
    await peerdbRequest('/v1/flows/list')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok'
    )
  })

  test('a non-2xx upstream becomes a PeerDBAgentError carrying its status, without the upstream host', async () => {
    process.env.PEERDB_API_URL = 'http://internal-peerdb.test'
    stubFetch(
      () => new Response('nope', { status: 404, statusText: 'Not Found' })
    )
    const err = await rejection(peerdbRequest('/v1/flows/x'))
    expect(err).toBeInstanceOf(PeerDBAgentError)
    expect(err.status).toBe(404)
    expect(err.message).toBe('PeerDB API error 404: Not Found')
    expect(err.message).not.toContain('internal-peerdb')
  })

  test('a network failure is a 502 that does not leak the URL', async () => {
    process.env.PEERDB_API_URL = 'http://internal-peerdb.test'
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const err = await rejection(peerdbRequest('/v1/flows/list'))
    expect(err.status).toBe(502)
    expect(err.message).toBe('Failed to reach PeerDB: ECONNREFUSED')
    expect(err.message).not.toContain('internal-peerdb')
  })

  test('a non-Error rejection is reported as unknown', async () => {
    process.env.PEERDB_API_URL = 'http://peerdb.test'
    globalThis.fetch = (async () => {
      throw 'weird'
    }) as unknown as typeof fetch
    const err = await rejection(peerdbRequest('/v1/flows/list'))
    expect(err.message).toBe('Failed to reach PeerDB: unknown error')
  })

  test('an aborted request is reported as a timeout (502)', async () => {
    process.env.PEERDB_API_URL = 'http://peerdb.test'
    globalThis.fetch = (async () => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    }) as unknown as typeof fetch
    const err = await rejection(peerdbRequest('/v1/flows/list'))
    expect(err.status).toBe(502)
    expect(err.message).toBe('PeerDB request timed out after 10000ms')
  })

  test('the request is given an abort signal so a hung upstream cannot block the agent', async () => {
    process.env.PEERDB_API_URL = 'http://peerdb.test'
    const fetchMock = stubFetch(() => new Response('{}'))
    await peerdbRequest('/v1/flows/list')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
