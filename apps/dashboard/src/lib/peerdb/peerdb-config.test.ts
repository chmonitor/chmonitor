import {
  getPeerDBConfig,
  isPeerDBEnabled,
  PeerDBError,
  peerdbFetch,
  readNonNegativeIntEnv,
} from './peerdb-config'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Snapshot + restore a set of env vars around a test scope. */
function _withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void
): () => void {
  return () => {
    const originals: Record<string, string | undefined> = {}
    for (const key of Object.keys(vars)) {
      originals[key] = process.env[key]
    }

    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }

    try {
      fn()
    } finally {
      for (const [key, orig] of Object.entries(originals)) {
        if (orig === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = orig
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// isPeerDBEnabled
// ---------------------------------------------------------------------------

describe('isPeerDBEnabled', () => {
  let orig: string | undefined

  beforeEach(() => {
    orig = process.env.PEERDB_API_URL
  })

  afterEach(() => {
    if (orig === undefined) {
      delete process.env.PEERDB_API_URL
    } else {
      process.env.PEERDB_API_URL = orig
    }
  })

  test('returns false when PEERDB_API_URL is unset', () => {
    delete process.env.PEERDB_API_URL
    expect(isPeerDBEnabled()).toBe(false)
  })

  test('returns false when PEERDB_API_URL is empty string', () => {
    process.env.PEERDB_API_URL = ''
    expect(isPeerDBEnabled()).toBe(false)
  })

  test('returns false when PEERDB_API_URL is only whitespace', () => {
    process.env.PEERDB_API_URL = '   '
    expect(isPeerDBEnabled()).toBe(false)
  })

  test('returns true when PEERDB_API_URL has a real value', () => {
    process.env.PEERDB_API_URL = 'http://localhost:8113'
    expect(isPeerDBEnabled()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getPeerDBConfig
// ---------------------------------------------------------------------------

describe('getPeerDBConfig', () => {
  let origUrl: string | undefined
  let origPassword: string | undefined

  beforeEach(() => {
    origUrl = process.env.PEERDB_API_URL
    origPassword = process.env.PEERDB_PASSWORD
  })

  afterEach(() => {
    if (origUrl === undefined) {
      delete process.env.PEERDB_API_URL
    } else {
      process.env.PEERDB_API_URL = origUrl
    }
    if (origPassword === undefined) {
      delete process.env.PEERDB_PASSWORD
    } else {
      process.env.PEERDB_PASSWORD = origPassword
    }
  })

  test('returns null when PEERDB_API_URL is unset', () => {
    delete process.env.PEERDB_API_URL
    expect(getPeerDBConfig()).toBeNull()
  })

  test('returns null when PEERDB_API_URL is empty', () => {
    process.env.PEERDB_API_URL = ''
    expect(getPeerDBConfig()).toBeNull()
  })

  test('returns config with baseUrl stripped of trailing slashes', () => {
    process.env.PEERDB_API_URL = 'http://flow-api:8113///'
    delete process.env.PEERDB_PASSWORD

    const config = getPeerDBConfig()
    expect(config).not.toBeNull()
    expect(config!.baseUrl).toBe('http://flow-api:8113')
  })

  test('trims whitespace from PEERDB_API_URL', () => {
    process.env.PEERDB_API_URL = '  http://localhost:8113  '
    delete process.env.PEERDB_PASSWORD

    const config = getPeerDBConfig()
    expect(config!.baseUrl).toBe('http://localhost:8113')
  })

  test('password is undefined when PEERDB_PASSWORD is unset', () => {
    process.env.PEERDB_API_URL = 'http://localhost:8113'
    delete process.env.PEERDB_PASSWORD

    const config = getPeerDBConfig()
    expect(config!.password).toBeUndefined()
  })

  test('password is undefined when PEERDB_PASSWORD is empty string', () => {
    process.env.PEERDB_API_URL = 'http://localhost:8113'
    process.env.PEERDB_PASSWORD = ''

    const config = getPeerDBConfig()
    expect(config!.password).toBeUndefined()
  })

  test('password is undefined when PEERDB_PASSWORD is only whitespace', () => {
    process.env.PEERDB_API_URL = 'http://localhost:8113'
    process.env.PEERDB_PASSWORD = '   '

    const config = getPeerDBConfig()
    expect(config!.password).toBeUndefined()
  })

  test('password is set when PEERDB_PASSWORD has a value', () => {
    process.env.PEERDB_API_URL = 'http://localhost:8113'
    process.env.PEERDB_PASSWORD = 'supersecret'

    const config = getPeerDBConfig()
    expect(config!.password).toBe('supersecret')
  })

  test('password is trimmed', () => {
    process.env.PEERDB_API_URL = 'http://localhost:8113'
    process.env.PEERDB_PASSWORD = '  trimmed  '

    const config = getPeerDBConfig()
    expect(config!.password).toBe('trimmed')
  })

  test('baseUrl keeps a single trailing non-slash segment intact', () => {
    process.env.PEERDB_API_URL = 'http://localhost:8113'
    delete process.env.PEERDB_PASSWORD

    const config = getPeerDBConfig()
    expect(config!.baseUrl).toBe('http://localhost:8113')
  })
})

// ---------------------------------------------------------------------------
// readNonNegativeIntEnv
// ---------------------------------------------------------------------------

describe('readNonNegativeIntEnv', () => {
  const KEY = '_TEST_RNNINT_ENV_'
  let orig: string | undefined

  beforeEach(() => {
    orig = process.env[KEY]
  })

  afterEach(() => {
    if (orig === undefined) {
      delete process.env[KEY]
    } else {
      process.env[KEY] = orig
    }
  })

  test('returns fallback when env var is unset', () => {
    delete process.env[KEY]
    expect(readNonNegativeIntEnv(KEY, 42)).toBe(42)
  })

  test('returns fallback when env var is empty string', () => {
    process.env[KEY] = ''
    expect(readNonNegativeIntEnv(KEY, 42)).toBe(42)
  })

  test('returns fallback when env var is whitespace', () => {
    process.env[KEY] = '  '
    expect(readNonNegativeIntEnv(KEY, 42)).toBe(42)
  })

  test('parses a valid integer', () => {
    process.env[KEY] = '100'
    expect(readNonNegativeIntEnv(KEY, 42)).toBe(100)
  })

  test('floors a float to an integer', () => {
    process.env[KEY] = '7.9'
    expect(readNonNegativeIntEnv(KEY, 42)).toBe(7)
  })

  test('returns 0 for "0"', () => {
    process.env[KEY] = '0'
    expect(readNonNegativeIntEnv(KEY, 42)).toBe(0)
  })

  test('returns fallback for a negative value', () => {
    process.env[KEY] = '-1'
    expect(readNonNegativeIntEnv(KEY, 42)).toBe(42)
  })

  test('returns fallback for NaN ("abc")', () => {
    process.env[KEY] = 'abc'
    expect(readNonNegativeIntEnv(KEY, 42)).toBe(42)
  })

  test('returns fallback for Infinity', () => {
    process.env[KEY] = 'Infinity'
    expect(readNonNegativeIntEnv(KEY, 42)).toBe(42)
  })

  test('trims whitespace before parsing', () => {
    process.env[KEY] = '  55  '
    expect(readNonNegativeIntEnv(KEY, 42)).toBe(55)
  })
})

// ---------------------------------------------------------------------------
// PeerDBError
// ---------------------------------------------------------------------------

describe('PeerDBError', () => {
  test('is instanceof Error', () => {
    const err = new PeerDBError('something broke', 503)
    expect(err).toBeInstanceOf(Error)
  })

  test('name is PeerDBError', () => {
    const err = new PeerDBError('something broke', 503)
    expect(err.name).toBe('PeerDBError')
  })

  test('message is preserved', () => {
    const err = new PeerDBError('my message', 404)
    expect(err.message).toBe('my message')
  })

  test('status is preserved', () => {
    const err = new PeerDBError('err', 502)
    expect(err.status).toBe(502)
  })
})

// ---------------------------------------------------------------------------
// peerdbFetch — unit tests with mocked fetch
// ---------------------------------------------------------------------------

describe('peerdbFetch', () => {
  let origUrl: string | undefined
  let origPassword: string | undefined
  let origScheme: string | undefined
  let origTimeout: string | undefined
  let origFetch: typeof globalThis.fetch

  beforeEach(() => {
    origUrl = process.env.PEERDB_API_URL
    origPassword = process.env.PEERDB_PASSWORD
    origScheme = process.env.PEERDB_AUTH_SCHEME
    origTimeout = process.env.PEERDB_FETCH_TIMEOUT_MS
    origFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = origFetch

    if (origUrl === undefined) {
      delete process.env.PEERDB_API_URL
    } else {
      process.env.PEERDB_API_URL = origUrl
    }
    if (origPassword === undefined) {
      delete process.env.PEERDB_PASSWORD
    } else {
      process.env.PEERDB_PASSWORD = origPassword
    }
    if (origScheme === undefined) {
      delete process.env.PEERDB_AUTH_SCHEME
    } else {
      process.env.PEERDB_AUTH_SCHEME = origScheme
    }
    if (origTimeout === undefined) {
      delete process.env.PEERDB_FETCH_TIMEOUT_MS
    } else {
      process.env.PEERDB_FETCH_TIMEOUT_MS = origTimeout
    }
  })

  test('throws PeerDBError(503) when PeerDB is not configured', async () => {
    delete process.env.PEERDB_API_URL

    await expect(peerdbFetch('/v1/peers')).rejects.toMatchObject({
      name: 'PeerDBError',
      status: 503,
    })
  })

  test('calls fetch with the correct URL from baseUrl + path', async () => {
    process.env.PEERDB_API_URL = 'http://flow-api:8113'
    delete process.env.PEERDB_PASSWORD

    let capturedUrl: string | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return new Response(JSON.stringify({ data: 'ok' }), { status: 200 })
    })

    await peerdbFetch('/v1/peers')
    expect(capturedUrl).toBe('http://flow-api:8113/v1/peers')
  })

  test('adds leading slash to path when missing', async () => {
    process.env.PEERDB_API_URL = 'http://flow-api:8113'
    delete process.env.PEERDB_PASSWORD

    let capturedUrl: string | undefined

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return new Response(JSON.stringify({}), { status: 200 })
    })

    await peerdbFetch('v1/peers')
    expect(capturedUrl).toBe('http://flow-api:8113/v1/peers')
  })

  test('sets Content-Type: application/json', async () => {
    process.env.PEERDB_API_URL = 'http://flow-api:8113'
    delete process.env.PEERDB_PASSWORD

    let capturedHeaders: Record<string, string> = {}

    globalThis.fetch = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>
        return new Response(JSON.stringify({}), { status: 200 })
      }
    )

    // Use a unique path so the module-level cache never has a hit for this test
    await peerdbFetch('/v1/content-type-check')
    expect(capturedHeaders['Content-Type']).toBe('application/json')
  })

  test('includes Basic auth header when password is set', async () => {
    process.env.PEERDB_API_URL = 'http://flow-api:8113'
    process.env.PEERDB_PASSWORD = 'secret'

    let capturedHeaders: Record<string, string> = {}

    globalThis.fetch = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>
        return new Response(JSON.stringify({}), { status: 200 })
      }
    )

    // Unique path avoids cache collision from other tests
    await peerdbFetch('/v1/auth-header-check')

    // PeerDB uses Basic auth with empty username: base64(":" + password)
    const expected = `Basic ${Buffer.from(':secret').toString('base64')}`
    expect(capturedHeaders.Authorization).toBe(expected)
  })

  test('uses Bearer auth when PEERDB_AUTH_SCHEME=bearer', async () => {
    process.env.PEERDB_API_URL = 'http://flow-api:8113'
    process.env.PEERDB_PASSWORD = 'token'
    process.env.PEERDB_AUTH_SCHEME = 'bearer'

    let capturedHeaders: Record<string, string> = {}
    globalThis.fetch = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>
        return new Response(JSON.stringify({}), { status: 200 })
      }
    )

    await peerdbFetch('/v1/bearer-auth-check')
    expect(capturedHeaders.Authorization).toBe('Bearer token')
  })

  test('reads PEERDB_FETCH_TIMEOUT_MS per request', async () => {
    process.env.PEERDB_API_URL = 'http://flow-api:8113'
    delete process.env.PEERDB_PASSWORD
    delete process.env.PEERDB_AUTH_SCHEME
    process.env.PEERDB_FETCH_TIMEOUT_MS = '37'

    const originalSetTimeout = globalThis.setTimeout
    const delays: number[] = []
    globalThis.setTimeout = ((
      callback: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      delays.push(Number(ms))
      return originalSetTimeout(callback, 0, ...args)
    }) as unknown as typeof globalThis.setTimeout
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({}), { status: 200 })
    )

    try {
      await peerdbFetch('/v1/lazy-timeout-check')
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
    expect(delays).toContain(37)
  })

  test('omits Authorization header when no password', async () => {
    process.env.PEERDB_API_URL = 'http://flow-api:8113'
    delete process.env.PEERDB_PASSWORD

    let capturedHeaders: Record<string, string> = {}

    globalThis.fetch = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>
        return new Response(JSON.stringify({}), { status: 200 })
      }
    )

    // Unique path avoids cache collision
    await peerdbFetch('/v1/no-auth-check')
    expect(capturedHeaders.Authorization).toBeUndefined()
  })

  test('returns parsed JSON on 2xx response', async () => {
    process.env.PEERDB_API_URL = 'http://flow-api:8113'
    delete process.env.PEERDB_PASSWORD

    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ peers: ['a', 'b'] }), { status: 200 })
    )

    // Unique path avoids cache collision
    const result = await peerdbFetch<{ peers: string[] }>(
      '/v1/json-parse-check'
    )
    expect(result).toEqual({ peers: ['a', 'b'] })
  })

  test('throws PeerDBError with upstream status on non-2xx response', async () => {
    process.env.PEERDB_API_URL = 'http://flow-api:8113'
    delete process.env.PEERDB_PASSWORD

    globalThis.fetch = mock(
      async () =>
        new Response('Not Found', { status: 404, statusText: 'Not Found' })
    )

    // Non-2xx responses are not cached, any path is fine
    await expect(peerdbFetch('/v1/missing')).rejects.toMatchObject({
      name: 'PeerDBError',
      status: 404,
    })
  })

  test('throws PeerDBError(502) when fetch connection fails', async () => {
    process.env.PEERDB_API_URL = 'http://flow-api:8113'
    delete process.env.PEERDB_PASSWORD

    globalThis.fetch = mock(async () => {
      throw new TypeError('fetch failed')
    })

    // Unique path: connection errors are not cached but avoid any prior hit
    await expect(
      peerdbFetch('/v1/connection-fail-check')
    ).rejects.toMatchObject({
      name: 'PeerDBError',
      status: 502,
    })
  })

  test('throws PeerDBError(502) on AbortError (timeout simulation)', async () => {
    process.env.PEERDB_API_URL = 'http://flow-api:8113'
    delete process.env.PEERDB_PASSWORD

    globalThis.fetch = mock(async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    })

    // Unique path: AbortErrors are not cached
    let rejection: unknown
    try {
      await peerdbFetch('/v1/abort-check')
    } catch (e) {
      rejection = e
    }
    expect(rejection).toBeInstanceOf(PeerDBError)
    expect((rejection as PeerDBError).status).toBe(502)
    expect((rejection as PeerDBError).message).toContain('timed out')
  })
})
