/**
 * Tests for routes/api/v1/explain.ts — feature-permission authz (#3221) and
 * readonly ClickHouse setting enforcement (#3220).
 *
 * Security guarantees under test:
 *   1. AUTHZ PARITY: /api/v1/explain must call authorizeFeatureRequest with the
 *      same EXPLORER_QUERY_FEATURE_PERMISSION as /api/v1/explorer/query, so an
 *      anonymous caller under CHM_CLERK_PUBLIC_READ is rejected (401) instead of
 *      reaching ClickHouse. Every other user-SQL execution route enforces this.
 *   2. READONLY ENFORCEMENT: both EXPLAIN execution paths (text via
 *      client.query, and JSONEachRow via fetchData) must pass readonly: 1 in
 *      clickhouse_settings, so a validation bypass cannot escalate to DML/DDL.
 *
 * Mocking strategy mirrors __tests__/actions.test.ts: mock.module() for
 * cloudflare:workers, @chm/clickhouse-client, @chm/logger, @chm/sql-builder,
 * @/lib/api/server-env, @/lib/cloud/reject-demo-host, and
 * @/lib/feature-permissions/server — all BEFORE the dynamic import of the
 * Route module so Bun's module registry sees the stubs.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// --- Module mocks (must be before any import of the Route module) ---

let authGateResponse: Response | null = null

// authorizeFeatureRequest returns null → allowed; a Response → rejected
const authorizeFeatureRequest = mock(async () => authGateResponse)

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
  },
}))

mock.module('@/lib/api/server-env', () => ({
  bridgeClickHouseEnv: mock(() => undefined),
}))

mock.module('@/lib/cloud/reject-demo-host', () => ({
  demoHiddenUnavailable: () => ({ reason: 'demo_hidden' }),
  isDemoHostBlockedForRequest: mock(async () => false),
}))

mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest,
}))

mock.module('@/lib/feature-permissions/permissions', () => ({
  EXPLORER_QUERY_FEATURE_PERMISSION: {
    feature: 'tables',
    operation: 'write',
  },
}))

mock.module('@chm/logger', () => ({
  debug: mock(() => undefined),
  error: mock(() => undefined),
}))

mock.module('@chm/sql-builder', () => ({
  validateSqlQuery: () => undefined,
  stripTrailingFormat: (q: string) => q,
}))

// fetchData mock — bun's mock automatically tracks calls
const mockFetchData = mock(
  async (): Promise<{
    data: unknown[] | null
    error: unknown
    metadata: Record<string, unknown>
  }> => ({
    data: [],
    error: null,
    metadata: {
      queryId: '',
      duration: 0,
      rows: 0,
      host: '0',
    },
  })
)

// client.query mock — bun's mock automatically tracks calls
const mockClientQuery = mock(async () => ({
  text: async () => 'explain_line_1\nexplain_line_2',
  query_id: 'test-query-id',
}))

const mockGetClient = mock(async () => ({
  query: mockClientQuery,
}))

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
  getAndValidateClientConfig: mock(() => ({
    id: 0,
    host: 'http://localhost:8123',
    user: 'default',
    password: '',
  })),
  getClient: mockGetClient,
}))

mock.module('@chm/clickhouse-client/constants', () => ({
  QUERY_COMMENT: '// explain-test\n',
}))

type Handler = (ctx: { request: Request }) => Promise<Response>

function getHandler(
  route: { options: { server?: unknown } },
  method: 'GET' | 'POST'
): Handler {
  const handlers = (
    route.options.server as { handlers?: Record<string, Handler> }
  )?.handlers
  const fn = handlers?.[method]
  if (!fn) throw new Error(`Route has no ${method} handler`)
  return fn
}

const { Route } = await import('./explain')
const getHandlerFn = getHandler(Route, 'GET')
const postHandlerFn = getHandler(Route, 'POST')

function get(hostId: string, query: string, mode: string): Promise<Response> {
  return getHandlerFn({
    request: new Request(
      `http://x/api/v1/explain?hostId=${hostId}&query=${encodeURIComponent(query)}&mode=${mode}`
    ),
  })
}

function post(hostId: number, query: string, mode: string): Promise<Response> {
  return postHandlerFn({
    request: new Request('http://x/api/v1/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId, query, mode }),
    }),
  })
}

describe('explain route — authz + readonly', () => {
  beforeEach(() => {
    authGateResponse = null
    mockFetchData.mockClear()
    mockClientQuery.mockClear()
    mockGetClient.mockClear()
    authorizeFeatureRequest.mockClear()
  })

  afterEach(() => {
    authGateResponse = null
  })

  // --- (#3221) AUTHZ PARITY: unauthorized request rejected ---

  describe('GET /api/v1/explain — authz parity (#3221)', () => {
    test('rejects unauthorized request (anonymous under public-read) with 401', async () => {
      // authorizeFeatureRequest returns a 401 Response → caller is blocked
      authGateResponse = new Response(
        JSON.stringify({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Feature "tables" requires authentication.',
          },
        }),
        { status: 401, headers: { 'www-authenticate': 'Bearer' } }
      )

      const res = await get('0', 'SELECT 1', '')
      expect(res.status).toBe(401)
      expect(authorizeFeatureRequest).toHaveBeenCalledTimes(1)
      // ClickHouse must never be reached when unauthorized
      expect(mockFetchData).not.toHaveBeenCalled()
      expect(mockGetClient).not.toHaveBeenCalled()
    })

    test('passes authorized request through to ClickHouse', async () => {
      authGateResponse = null

      const res = await get('0', 'SELECT 1', '')
      expect(res.status).toBe(200)
      expect(authorizeFeatureRequest).toHaveBeenCalledTimes(1)
      expect(mockFetchData).toHaveBeenCalledTimes(1)
    })
  })

  describe('POST /api/v1/explain — authz parity (#3221)', () => {
    test('rejects unauthorized request (anonymous under public-read) with 401', async () => {
      authGateResponse = new Response(
        JSON.stringify({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Feature "tables" requires authentication.',
          },
        }),
        { status: 401, headers: { 'www-authenticate': 'Bearer' } }
      )

      const res = await post(0, 'SELECT 1', '')
      expect(res.status).toBe(401)
      expect(authorizeFeatureRequest).toHaveBeenCalledTimes(1)
      expect(mockFetchData).not.toHaveBeenCalled()
      expect(mockGetClient).not.toHaveBeenCalled()
    })

    test('passes authorized request through to ClickHouse', async () => {
      authGateResponse = null

      const res = await post(0, 'SELECT 1', '')
      expect(res.status).toBe(200)
      expect(authorizeFeatureRequest).toHaveBeenCalledTimes(1)
      expect(mockFetchData).toHaveBeenCalledTimes(1)
    })
  })

  // --- (#3220) READONLY ENFORCEMENT ---

  describe('GET /api/v1/explain — readonly setting (#3220)', () => {
    beforeEach(() => {
      authGateResponse = null
    })

    test('default (PLAN) mode passes readonly: 1 to fetchData', async () => {
      // Empty modeParam → EXPLAIN (defaults to PLAN), JSONEachRow path via fetchData
      const res = await get('0', 'SELECT 1', '')
      expect(res.status).toBe(200)
      expect(mockFetchData).toHaveBeenCalledTimes(1)

      const callArgs = mockFetchData.mock.calls[0][0] as {
        query: string
        hostId: number
        format: string
        clickhouse_settings?: Record<string, unknown>
      }
      expect(callArgs.clickhouse_settings).toBeDefined()
      expect(callArgs.clickhouse_settings?.readonly).toBe('1')
    })

    test('AST mode passes readonly: 1 to client.query (text path)', async () => {
      const res = await get('0', 'SELECT 1', 'AST')
      expect(res.status).toBe(200)
      expect(mockGetClient).toHaveBeenCalledTimes(1)
      expect(mockClientQuery).toHaveBeenCalledTimes(1)

      const callArgs = mockClientQuery.mock.calls[0][0] as {
        query: string
        format: string
        clickhouse_settings?: Record<string, unknown>
      }
      expect(callArgs.clickhouse_settings).toBeDefined()
      expect(callArgs.clickhouse_settings?.readonly).toBe('1')
    })

    test('SYNTAX mode passes readonly: 1 to client.query (text path)', async () => {
      const res = await get('0', 'SELECT 1', 'SYNTAX')
      expect(res.status).toBe(200)
      expect(mockClientQuery).toHaveBeenCalledTimes(1)

      const callArgs = mockClientQuery.mock.calls[0][0] as {
        clickhouse_settings?: Record<string, unknown>
      }
      expect(callArgs.clickhouse_settings?.readonly).toBe('1')
    })

    test('PIPELINE mode passes readonly: 1 to fetchData', async () => {
      const res = await get('0', 'SELECT 1', 'PIPELINE')
      expect(res.status).toBe(200)
      expect(mockFetchData).toHaveBeenCalledTimes(1)

      const callArgs = mockFetchData.mock.calls[0][0] as {
        clickhouse_settings?: Record<string, unknown>
      }
      expect(callArgs.clickhouse_settings?.readonly).toBe('1')
    })

    test('ESTIMATE mode passes readonly: 1 to fetchData', async () => {
      const res = await get('0', 'SELECT 1', 'ESTIMATE')
      expect(res.status).toBe(200)
      expect(mockFetchData).toHaveBeenCalledTimes(1)

      const callArgs = mockFetchData.mock.calls[0][0] as {
        clickhouse_settings?: Record<string, unknown>
      }
      expect(callArgs.clickhouse_settings?.readonly).toBe('1')
    })
  })

  describe('POST /api/v1/explain — readonly setting (#3220)', () => {
    beforeEach(() => {
      authGateResponse = null
    })

    test('default (PLAN) mode passes readonly: 1 to fetchData', async () => {
      const res = await post(0, 'SELECT 1', '')
      expect(res.status).toBe(200)
      expect(mockFetchData).toHaveBeenCalledTimes(1)

      const callArgs = mockFetchData.mock.calls[0][0] as {
        clickhouse_settings?: Record<string, unknown>
      }
      expect(callArgs.clickhouse_settings?.readonly).toBe('1')
    })

    test('AST mode passes readonly: 1 to client.query (text path)', async () => {
      const res = await post(0, 'SELECT 1', 'AST')
      expect(res.status).toBe(200)
      expect(mockClientQuery).toHaveBeenCalledTimes(1)

      const callArgs = mockClientQuery.mock.calls[0][0] as {
        clickhouse_settings?: Record<string, unknown>
      }
      expect(callArgs.clickhouse_settings?.readonly).toBe('1')
    })
  })
})
