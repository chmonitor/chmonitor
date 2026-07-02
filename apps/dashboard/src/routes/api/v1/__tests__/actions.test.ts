/**
 * Tests for routes/api/v1/actions.ts — error sanitization
 *
 * Verifies that each action handler (killQuery, optimizeTable, querySettings)
 * redacts raw ClickHouse error details from client-visible response messages.
 *
 * Security guarantee: when ClickHouse throws an error whose message contains a
 * secret token (e.g. an internal table name, host address, auth token), that
 * token must NOT appear in the HTTP response body returned to the caller.
 *
 * The test plants a distinctive token ("system.secret_table does not exist")
 * in the mocked ClickHouse error and asserts:
 *   - The token is absent from response.message
 *   - The sanitized bucket string IS present (proves redaction, not just silence)
 *   - HTTP status is 500 (error path, unchanged by this fix)
 *
 * Mocking strategy (mirrors menu-counts/__tests__/index.test.ts):
 *   - mock.module() for cloudflare:workers, @chm/clickhouse-client, @chm/logger,
 *     @/lib/api/server-env, @/lib/feature-permissions/server
 *   - All mocks are declared BEFORE the dynamic import of the Route module so
 *     Bun's module registry sees the stubs.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// --- Module mocks (must be before any import of the Route module) ---

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
  },
}))

// Permission gate: return null → request is allowed through
mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: mock(async () => null),
}))

mock.module('@/lib/api/server-env', () => ({
  bridgeClickHouseEnv: mock(() => undefined),
}))

mock.module('@chm/logger', () => ({
  ErrorLogger: { logError: mock(() => undefined) },
  log: mock(() => undefined),
  isDebugEnabled: mock(() => false),
}))

// Mutable mock so each test can configure its own behavior
const mockFetchData = mock(
  async (
    _args: unknown
  ): Promise<{ data: unknown[] | null; error: unknown }> => ({
    data: [],
    error: null,
  })
)

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
}))

// --- Helpers ---

/** Build a POST request to /api/v1/actions with a JSON body */
function makeRequest(body: unknown, hostId = 0): Request {
  return new Request(`http://localhost/api/v1/actions?hostId=${hostId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type PostHandler = (ctx: { request: Request }) => Promise<Response>

/**
 * Extracts the POST handler from a TanStack Start server route.
 *
 * Route.options.server.handlers is typed as `Constrain<{POST: fn}, ...>` which
 * is a union that TypeScript can't narrow further without a type assertion.
 * At runtime the value is always the plain `{ POST: fn }` object shape;
 * this cast is the minimal widening needed to access it.
 */
function getPostHandler(route: { options: { server?: unknown } }): PostHandler {
  const handlers = (
    route.options.server as { handlers?: { POST?: PostHandler } }
  )?.handlers
  const fn = handlers?.POST
  if (!fn) throw new Error('Route has no POST handler')
  return fn
}

/**
 * Planted secret that must never appear in any client response.
 * It contains an internal table name — exactly the kind of detail
 * ClickHouse embeds in error messages that we must redact.
 */
const SECRET_TOKEN = 'system.secret_table'
const RAW_CH_ERROR = `Table ${SECRET_TOKEN} does not exist`

// --- Tests ---

describe('actions route — killQuery error sanitization', () => {
  beforeEach(() => {
    mockFetchData.mockClear()
  })

  test('redacts ClickHouse error details from killQuery response', async () => {
    mockFetchData.mockImplementation(async () => ({
      data: null,
      error: { message: RAW_CH_ERROR, type: 'query_error' },
    }))

    const { Route } = await import('../actions')
    const handler = getPostHandler(Route)

    const response = await handler({
      request: makeRequest({
        action: 'killQuery',
        params: { queryId: 'abc-123' },
      }),
    })

    expect(response.status).toBe(500)

    const body = (await response.json()) as {
      success: boolean
      message: string
    }
    expect(body.success).toBe(false)

    // Secret token must not be present in the client response
    expect(body.message).not.toContain(SECRET_TOKEN)

    // The sanitized bucket string must be present (proves active redaction)
    expect(body.message).toContain('Resource not found')

    // Context prefix is preserved
    expect(body.message).toContain('Failed to kill query abc-123')
  })

  test('killQuery success path is unaffected', async () => {
    mockFetchData.mockImplementation(async () => ({ data: [], error: null }))

    const { Route } = await import('../actions')
    const handler = getPostHandler(Route)
    const response = await handler({
      request: makeRequest({
        action: 'killQuery',
        params: { queryId: 'abc-123' },
      }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      success: boolean
      message: string
    }
    expect(body.success).toBe(true)
    expect(body.message).toContain('abc-123')
  })
})

describe('actions route — optimizeTable error sanitization', () => {
  beforeEach(() => {
    mockFetchData.mockClear()
  })

  test('redacts ClickHouse error details from optimizeTable response', async () => {
    mockFetchData.mockImplementation(async () => ({
      data: null,
      error: { message: RAW_CH_ERROR, type: 'query_error' },
    }))

    const { Route } = await import('../actions')
    const handler = getPostHandler(Route)

    const response = await handler({
      request: makeRequest({
        action: 'optimizeTable',
        params: { table: 'my_table' },
      }),
    })

    expect(response.status).toBe(500)

    const body = (await response.json()) as {
      success: boolean
      message: string
    }
    expect(body.success).toBe(false)

    // Secret token must not be in the client response
    expect(body.message).not.toContain(SECRET_TOKEN)

    // Sanitized bucket string must be present
    expect(body.message).toContain('Resource not found')

    // Context prefix preserved
    expect(body.message).toContain('Failed to optimize table my_table')
  })
})

describe('actions route — querySettings error sanitization', () => {
  beforeEach(() => {
    mockFetchData.mockClear()
  })

  test('redacts ClickHouse error details from querySettings response', async () => {
    mockFetchData.mockImplementation(async () => ({
      data: null,
      error: { message: RAW_CH_ERROR, type: 'query_error' },
    }))

    const { Route } = await import('../actions')
    const handler = getPostHandler(Route)

    const response = await handler({
      request: makeRequest({
        action: 'querySettings',
        params: { queryId: 'qid-456' },
      }),
    })

    expect(response.status).toBe(500)

    const body = (await response.json()) as {
      success: boolean
      message: string
    }
    expect(body.success).toBe(false)

    // Secret token must not be in the client response
    expect(body.message).not.toContain(SECRET_TOKEN)

    // Sanitized bucket string must be present
    expect(body.message).toContain('Resource not found')

    // Context prefix preserved
    expect(body.message).toContain('Failed to get query settings qid-456')
  })

  test('querySettings success path returns data and is unaffected', async () => {
    mockFetchData.mockImplementation(async () => ({
      data: [{ Settings: '{"max_threads":4}' }],
      error: null,
    }))

    const { Route } = await import('../actions')
    const handler = getPostHandler(Route)
    const response = await handler({
      request: makeRequest({
        action: 'querySettings',
        params: { queryId: 'qid-456' },
      }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      success: boolean
      data: unknown
    }
    expect(body.success).toBe(true)
  })
})

describe('actions route — PERMISSION error bucket is also redacted', () => {
  beforeEach(() => {
    mockFetchData.mockClear()
  })

  test('redacts "not enough privileges" to "Permission denied"', async () => {
    const privilegeError =
      'Not enough privileges. To execute killQuery, you need the SELECT grant on system.processes'

    mockFetchData.mockImplementation(async () => ({
      data: null,
      error: { message: privilegeError, type: 'permission_error' },
    }))

    const { Route } = await import('../actions')
    const handler = getPostHandler(Route)
    const response = await handler({
      request: makeRequest({
        action: 'killQuery',
        params: { queryId: 'abc-999' },
      }),
    })

    const body = (await response.json()) as { message: string }

    // The raw privileges error must not leak
    expect(body.message).not.toContain('system.processes')
    expect(body.message).not.toContain('SELECT grant')

    // Sanitized to permission bucket
    expect(body.message).toContain('Permission denied')
  })
})
