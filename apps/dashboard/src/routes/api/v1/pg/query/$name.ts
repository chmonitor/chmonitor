/**
 * Read-only Postgres query endpoint for the Postgres Insights pages (#2450).
 * POST /api/v1/pg/query/$name
 *
 * Resolves a `PgQueryConfig` by name and runs its single read-only statement
 * against a Postgres source, from EITHER:
 *   - `{ connectionId }`  → a server-stored (D1) per-user connection, or
 *   - `{ connection }`    → inline browser-stored credentials (localStorage),
 * mirroring the ClickHouse browser-proxy / user-connection split but on ONE
 * route (Postgres has a single execution path).
 *
 * Fail-closed behind `CHM_FEATURE_POSTGRES_SOURCE`. A missing required
 * extension (e.g. `pg_stat_statements`) returns an empty result flagged
 * `extensionMissing` so the page renders a graceful empty state — never a raw
 * Postgres error. All other failures are classified, logged, and returned as a
 * sanitized message.
 */

import { createFileRoute } from '@tanstack/react-router'

import { error as logError } from '@chm/logger'
import {
  formatPostgresError,
  type PostgresConnectionConfig,
} from '@chm/postgres-client'
import { classifyConnectionError } from '@/lib/connection-errors'
import {
  credentialsToPgConfig,
  executePgQuery,
  isPgExtensionInstalled,
} from '@/lib/connection-query/execute-pg-query'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'
import { resolveConnectionStore } from '@/lib/connection-store/resolve-store'
import { getUserConnectionsServerConfig } from '@/lib/connection-store/server-feature'
import { featureFlags } from '@/lib/feature-flags'
import { getPgQueryConfigByName } from '@/lib/pg-query-config'

const ROUTE = '/api/v1/pg/query/$name'

interface InlinePgConnection {
  host: string
  user: string
  password: string
  port?: number
  database?: string
  sslmode?: string
}

interface PgQueryBody {
  connectionId?: string
  connection?: InlinePgConnection
}

function jsonError(
  type: string,
  message: string,
  status: number,
  details?: Record<string, string>
): Response {
  return Response.json(
    {
      success: false,
      error: { type, message, ...(details ? { details } : {}) },
    },
    { status }
  )
}

async function resolvePgConfig(
  body: PgQueryBody
): Promise<PostgresConnectionConfig | { error: Response }> {
  // Inline browser credentials take precedence when supplied.
  if (body.connection?.host && body.connection.user) {
    return credentialsToPgConfig({
      kind: 'postgres',
      host: body.connection.host,
      user: body.connection.user,
      password:
        typeof body.connection.password === 'string'
          ? body.connection.password
          : '',
      port: body.connection.port,
      database: body.connection.database,
      sslmode: body.connection.sslmode,
    })
  }

  if (body.connectionId) {
    if (!getUserConnectionsServerConfig().dbStorageEnabled) {
      return {
        error: jsonError(
          'permission_error',
          'Server-stored connections are not enabled.',
          501
        ),
      }
    }
    const userId = await resolveConnectionUserId()
    const store = await resolveConnectionStore()
    const credentials = await store.getCredentials(userId, body.connectionId)
    if (!credentials) {
      return {
        error: jsonError('permission_error', 'Connection not found', 404),
      }
    }
    return credentialsToPgConfig(credentials)
  }

  return {
    error: jsonError(
      'validation_error',
      'Missing connection: provide connectionId or connection credentials',
      400
    ),
  }
}

async function handlePost(request: Request, name: string): Promise<Response> {
  if (!featureFlags.postgresSource()) {
    return jsonError(
      'permission_error',
      'Postgres source engine is not enabled.',
      501
    )
  }

  const queryConfig = getPgQueryConfigByName(name)
  if (!queryConfig) {
    return jsonError(
      'table_not_found',
      `Postgres query not found: ${name}`,
      404
    )
  }

  let body: PgQueryBody
  try {
    body = (await request.json()) as PgQueryBody
  } catch {
    return jsonError('validation_error', 'Request body must be valid JSON', 400)
  }

  const resolved = await resolvePgConfig(body)
  if ('error' in resolved) return resolved.error
  const config = resolved

  try {
    // Extension gate (Postgres analog of `tableCheck`): a missing extension is
    // an expected, graceful empty state — not an error.
    if (
      queryConfig.extensionCheck &&
      !(await isPgExtensionInstalled(config, queryConfig.extensionCheck))
    ) {
      return Response.json({
        success: true,
        data: [],
        metadata: { duration: 0, rows: 0 },
        extensionMissing: true,
        extension: queryConfig.extensionCheck,
      })
    }

    const result = await executePgQuery(config, queryConfig.sql)
    return Response.json({
      success: true,
      data: result.data,
      metadata: result.metadata,
    })
  } catch (err) {
    const raw = formatPostgresError(err)
    logError(`[${ROUTE}] Postgres query failed for "${name}": ${raw}`)
    const classified = classifyConnectionError(raw)
    return jsonError('query_error', classified.title, 502, {
      kind: classified.kind,
    })
  }
}

export const Route = createFileRoute('/api/v1/pg/query/$name')({
  server: {
    handlers: {
      POST: async ({ request, params }) => handlePost(request, params.name),
    },
  },
})
