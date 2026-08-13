/**
 * Unit tests for the rate-limit guards on the unauthenticated
 * browser-connections routes (#2978).
 *
 * `/api/v1/browser-connections/test` and `/api/v1/browser-connections/sessions`
 * both dial an attacker-supplied host on every request (ClickHouse
 * `SELECT version()`/`SELECT 1`, or Postgres `getPostgresVersion()`) with no
 * auth. This reuses the same `checkRateLimitDurable` in-memory token bucket
 * pattern already guarding `/api/mcp` (see
 * `routes/api/__tests__/mcp-rate-limit.test.ts`), so this file mirrors that
 * structure: allowed under the configured limit, blocked (429 + Retry-After)
 * once exhausted, and independent buckets per client IP.
 *
 * It also covers the two acceptance criteria specific to this issue:
 *  - the two routes use DISTINCT bucket-key prefixes, so exhausting one route's
 *    budget for an IP does not 429 the other route for the same IP;
 *  - the rate-limit check runs BEFORE any outbound work, for both routes and
 *    (in `test.ts`) both source engines. This is proven without mocking any
 *    network module: each request body is crafted so the "allowed" path stops
 *    at a synchronous validation error (never opening a socket), while the
 *    "blocked" path with the SAME body must short-circuit to 429 instead —
 *    which is only possible if the rate-limit check runs ahead of that
 *    validation/outbound-adjacent code.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { _resetBucketsForTest } from '@/lib/api/rate-limiter'

const {
  __checkBrowserConnTestRateLimitForTests: checkTestRateLimit,
  __handlePostForTests: handleTestPost,
} = await import('../test')

const {
  __checkBrowserConnSessionsRateLimitForTests: checkSessionsRateLimit,
  __handlePostForTests: handleSessionsPost,
} = await import('../sessions')

const ORIGINAL_LIMIT = process.env.RATE_LIMIT_BROWSER_CONN_PER_MIN
const ORIGINAL_ENCRYPTION_KEY = process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY
const ORIGINAL_CLERK_SECRET = process.env.CLERK_SECRET_KEY

/** Valid 32-byte AES-256 key, base64-encoded (all-zero, test-only). */
const VALID_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64')

function makeRequest(url: string, body: unknown, ip = '203.0.113.1'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeTestRequest(body: unknown, ip = '203.0.113.1'): Request {
  return makeRequest(
    'https://dash.example.com/api/v1/browser-connections/test',
    body,
    ip
  )
}

function makeSessionsRequest(body: unknown, ip = '203.0.113.1'): Request {
  return makeRequest(
    'https://dash.example.com/api/v1/browser-connections/sessions',
    body,
    ip
  )
}

beforeEach(() => {
  _resetBucketsForTest()
  process.env.RATE_LIMIT_BROWSER_CONN_PER_MIN = '3'
})

afterEach(() => {
  _resetBucketsForTest()
  if (ORIGINAL_LIMIT === undefined) {
    delete process.env.RATE_LIMIT_BROWSER_CONN_PER_MIN
  } else {
    process.env.RATE_LIMIT_BROWSER_CONN_PER_MIN = ORIGINAL_LIMIT
  }
  if (ORIGINAL_ENCRYPTION_KEY === undefined) {
    delete process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY
  } else {
    process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY = ORIGINAL_ENCRYPTION_KEY
  }
  if (ORIGINAL_CLERK_SECRET === undefined) {
    delete process.env.CLERK_SECRET_KEY
  } else {
    process.env.CLERK_SECRET_KEY = ORIGINAL_CLERK_SECRET
  }
})

describe('checkBrowserConnTestRateLimit', () => {
  test('allows requests under the configured per-IP limit', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(await checkTestRateLimit(makeTestRequest({}))).toBeNull()
    }
  })

  test('blocks the request once the limit is exhausted with a 429', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(await checkTestRateLimit(makeTestRequest({}))).toBeNull()
    }

    const blocked = await checkTestRateLimit(makeTestRequest({}))
    expect(blocked).not.toBeNull()
    expect(blocked?.status).toBe(429)
    expect(blocked?.headers.get('Retry-After')).toBeTruthy()

    const body = (await blocked?.json()) as {
      success: boolean
      error: { type: string }
    }
    expect(body.success).toBe(false)
    expect(body.error.type).toBe('rate_limited')
  })

  test('different client IPs get independent buckets', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(
        await checkTestRateLimit(makeTestRequest({}, '203.0.113.1'))
      ).toBeNull()
    }
    expect(
      await checkTestRateLimit(makeTestRequest({}, '203.0.113.1'))
    ).not.toBeNull()
    expect(
      await checkTestRateLimit(makeTestRequest({}, '203.0.113.2'))
    ).toBeNull()
  })
})

describe('checkBrowserConnSessionsRateLimit', () => {
  test('allows requests under the configured per-IP limit', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(await checkSessionsRateLimit(makeSessionsRequest({}))).toBeNull()
    }
  })

  test('blocks the request once the limit is exhausted with a 429', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(await checkSessionsRateLimit(makeSessionsRequest({}))).toBeNull()
    }

    const blocked = await checkSessionsRateLimit(makeSessionsRequest({}))
    expect(blocked).not.toBeNull()
    expect(blocked?.status).toBe(429)
    expect(blocked?.headers.get('Retry-After')).toBeTruthy()
  })

  test('different client IPs get independent buckets', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(
        await checkSessionsRateLimit(makeSessionsRequest({}, '198.51.100.1'))
      ).toBeNull()
    }
    expect(
      await checkSessionsRateLimit(makeSessionsRequest({}, '198.51.100.1'))
    ).not.toBeNull()
    expect(
      await checkSessionsRateLimit(makeSessionsRequest({}, '198.51.100.2'))
    ).toBeNull()
  })
})

describe('independent buckets across routes (#2978 requirement)', () => {
  test('exhausting the test-route bucket for an IP does not 429 the sessions route for the same IP', async () => {
    const ip = '192.0.2.50'
    for (let i = 0; i < 3; i += 1) {
      expect(await checkTestRateLimit(makeTestRequest({}, ip))).toBeNull()
    }
    // test-route bucket is now exhausted for this IP...
    expect(await checkTestRateLimit(makeTestRequest({}, ip))).not.toBeNull()
    // ...but the sessions route's independent bucket is untouched.
    expect(await checkSessionsRateLimit(makeSessionsRequest({}, ip))).toBeNull()
  })

  test('exhausting the sessions-route bucket for an IP does not 429 the test route for the same IP', async () => {
    const ip = '192.0.2.51'
    for (let i = 0; i < 3; i += 1) {
      expect(
        await checkSessionsRateLimit(makeSessionsRequest({}, ip))
      ).toBeNull()
    }
    expect(
      await checkSessionsRateLimit(makeSessionsRequest({}, ip))
    ).not.toBeNull()
    expect(await checkTestRateLimit(makeTestRequest({}, ip))).toBeNull()
  })
})

describe('POST /api/v1/browser-connections/test — rate limit runs before outbound work', () => {
  // A syntactically invalid host makes `validateHostUrl` fail synchronously
  // (`new URL(host)` throws) — no DNS lookup, no socket. This proves the
  // "allowed" path reaches validation without needing to mock the network.
  const clickhouseBody = {
    host: 'not-a-valid-url',
    user: 'u',
    password: 'p',
  }
  // Missing `database` short-circuits handlePostgresTest before
  // `validatePostgresHost`/`getPostgresVersion` — same trick, postgres branch.
  const postgresBody = {
    host: 'example.com',
    user: 'u',
    password: 'p',
    engine: 'postgres',
  }

  test('clickhouse branch: under the limit reaches validation (400), not 429', async () => {
    const res = await handleTestPost(makeTestRequest(clickhouseBody))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: { message: string } }
    expect(json.error.message).toContain('Invalid host URL')
  })

  test('clickhouse branch: over the limit returns 429 before reaching validation', async () => {
    for (let i = 0; i < 3; i += 1) {
      await handleTestPost(makeTestRequest(clickhouseBody))
    }
    const res = await handleTestPost(makeTestRequest(clickhouseBody))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })

  test('postgres branch: under the limit reaches validation (400), not 429', async () => {
    const res = await handleTestPost(makeTestRequest(postgresBody))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: { message: string } }
    expect(json.error.message).toContain('Missing required field: database')
  })

  test('postgres branch: over the limit returns 429 before reaching validation', async () => {
    for (let i = 0; i < 3; i += 1) {
      await handleTestPost(makeTestRequest(postgresBody))
    }
    const res = await handleTestPost(makeTestRequest(postgresBody))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })
})

describe('POST /api/v1/browser-connections/sessions — exact check order (#2978)', () => {
  test('isEncryptionConfigured() 503 wins even when the rate limit is exhausted', async () => {
    delete process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY
    delete process.env.CLERK_SECRET_KEY

    for (let i = 0; i < 3; i += 1) {
      await handleSessionsPost(makeSessionsRequest({}))
    }
    // Bucket is exhausted, but the 503 (no socket, cheapest check) must still
    // win — proving isEncryptionConfigured() runs strictly before the rate
    // limit check, not after.
    const res = await handleSessionsPost(makeSessionsRequest({}))
    expect(res.status).toBe(503)
  })

  test('under the limit (encryption configured) reaches validation (400), not 429', async () => {
    process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY = VALID_ENCRYPTION_KEY
    const res = await handleSessionsPost(makeSessionsRequest({}))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: { message: string } }
    expect(json.error.message).toContain('Missing required field: host')
  })

  test('over the limit (encryption configured) returns 429 before validation/outbound', async () => {
    process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY = VALID_ENCRYPTION_KEY
    for (let i = 0; i < 3; i += 1) {
      await handleSessionsPost(makeSessionsRequest({}))
    }
    const res = await handleSessionsPost(makeSessionsRequest({}))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })
})
