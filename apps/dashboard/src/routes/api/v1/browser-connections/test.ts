/**
 * Browser Connection Test endpoint
 * POST /api/v1/browser-connections/test
 *
 * Validates a browser-provided ClickHouse connection by running SELECT version().
 * Credentials are provided in the request body and never logged.
 *
 * Ported from apps/dashboard/app/api/v1/browser-connections/test/route.ts.
 * - Per-route auth dropped; centralized in middleware (#1397).
 * - NextResponse replaced with standard Response / Response.json.
 */

import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@clickhouse/client-web'

import { formatPostgresError, getPostgresVersion } from '@chm/postgres-client'
import { isSourceEngine } from '@chm/types'
import { createValidationError } from '@/lib/api/error-handler'
import {
  createHostValidationFetch,
  validateHostUrl,
  validatePostgresHost,
} from '@/lib/browser-connections/host-url'

const ROUTE_CONTEXT = {
  route: '/api/v1/browser-connections/test',
  method: 'POST',
} as const

interface TestConnectionRequest {
  host: string
  user: string
  password: string
  /** Source engine; absent/omitted tests as ClickHouse. */
  engine?: string
  /** Postgres-only fields (engine === 'postgres'). */
  port?: number
  database?: string
  sslmode?: string
}

interface TestConnectionResponse {
  ok: boolean
  version?: string
  error?: string
}

async function handlePost(request: Request): Promise<Response> {
  let body: Partial<TestConnectionRequest>
  try {
    body = (await request.json()) as Partial<TestConnectionRequest>
  } catch {
    return createValidationError(
      'Request body must be valid JSON',
      ROUTE_CONTEXT
    )
  }

  const { host, user, password, engine } = body

  if (!host || typeof host !== 'string') {
    return createValidationError('Missing required field: host', ROUTE_CONTEXT)
  }
  if (!user || typeof user !== 'string') {
    return createValidationError('Missing required field: user', ROUTE_CONTEXT)
  }
  if (typeof password !== 'string') {
    return createValidationError(
      'Missing required field: password',
      ROUTE_CONTEXT
    )
  }
  if (engine !== undefined && !isSourceEngine(engine)) {
    return createValidationError(
      'engine must be one of: clickhouse, clickhouse-cloud, postgres',
      ROUTE_CONTEXT
    )
  }

  // Postgres uses a raw-TCP driver and its own SSRF guard (host:port, no URL).
  // clickhouse / clickhouse-cloud share the HTTP path below.
  if (engine === 'postgres') {
    return handlePostgresTest(body, user, password)
  }

  // Validate host URL and block SSRF targets
  const ssrfError = await validateHostUrl(host)
  if (ssrfError) {
    return createValidationError(ssrfError, ROUTE_CONTEXT)
  }

  try {
    const client = createClient({
      host,
      username: user,
      password,
      fetch: createHostValidationFetch(),
    })

    const result = await client.query({
      query: 'SELECT version() AS version',
      format: 'JSONEachRow',
    })

    const rows = (await result.json()) as { version: string }[]
    const version = rows[0]?.version

    const response: TestConnectionResponse = { ok: true, version }
    return Response.json(response, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed'
    const response: TestConnectionResponse = { ok: false, error: message }
    return Response.json(response, { status: 200 })
  }
}

/**
 * Test a Postgres source: SSRF-guard the host:port, then read `version()` via
 * the read-only `pg` client. Same `{ ok, version?, error? }` shape and always
 * HTTP 200 — errors are classified client-side. Postgres driver errors are
 * formatted with their SQLSTATE so the classifier can map them.
 */
async function handlePostgresTest(
  body: Partial<TestConnectionRequest>,
  user: string,
  password: string
): Promise<Response> {
  const host = (body.host ?? '').trim()
  const port = body.port ?? 5432
  const database = (body.database ?? '').trim()
  const sslmode = body.sslmode

  if (!database) {
    return createValidationError(
      'Missing required field: database',
      ROUTE_CONTEXT
    )
  }

  const ssrfError = await validatePostgresHost(host, port)
  if (ssrfError) {
    return createValidationError(ssrfError, ROUTE_CONTEXT)
  }

  try {
    const version = await getPostgresVersion({
      host,
      port,
      user,
      password,
      database,
      sslmode,
    })
    const response: TestConnectionResponse = { ok: true, version }
    return Response.json(response, { status: 200 })
  } catch (err) {
    const response: TestConnectionResponse = {
      ok: false,
      error: formatPostgresError(err),
    }
    return Response.json(response, { status: 200 })
  }
}

export const Route = createFileRoute('/api/v1/browser-connections/test')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})
