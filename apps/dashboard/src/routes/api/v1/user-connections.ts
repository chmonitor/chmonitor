/**
 * User connections API
 * GET  /api/v1/user-connections — list (metadata only)
 * POST /api/v1/user-connections — create
 */

import { createFileRoute } from '@tanstack/react-router'

import type { CreateUserConnectionInput } from '@/lib/connection-store/types'

import { formatPostgresError, queryPostgres } from '@chm/postgres-client'
import { isSourceEngine } from '@chm/types'
import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { logEvent } from '@/lib/audit/logEvent'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import { isBillingConfigured } from '@/lib/billing/polar-config'
import { resolveOwnerSubscription } from '@/lib/billing/user-subscription'
import {
  validateHostUrl,
  validatePostgresHost,
} from '@/lib/browser-connections/host-url'
import { isCloudModeServer } from '@/lib/cloud/cloud-mode'
import { queryConnection } from '@/lib/connection-query/connection-client'
import { mapConnectionApiError } from '@/lib/connection-store/api-errors'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'
import { resolveConnectionStore } from '@/lib/connection-store/resolve-store'
import { getUserConnectionsServerConfig } from '@/lib/connection-store/server-feature'
import { emitEvent } from '@/lib/events/outbound-bus'
import { buildPeerdbCredentialFields } from '@/lib/peerdb/peerdb-auth'

const ROUTE_GET = { route: '/api/v1/user-connections', method: 'GET' }
const ROUTE_POST = { route: '/api/v1/user-connections', method: 'POST' }

async function handleGet(): Promise<Response> {
  if (!getUserConnectionsServerConfig().dbStorageEnabled) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: 'User connections database storage is not enabled.',
      },
      501,
      ROUTE_GET
    )
  }

  try {
    const userId = await resolveConnectionUserId()
    const store = await resolveConnectionStore()
    const connections = await store.list(userId)
    return createSuccessResponse(
      connections.map((c) => ({
        id: c.id,
        name: c.name,
        host: c.hostUrl,
        user: c.chUser,
        hostId: c.hostId,
        engine: c.engine,
        source: 'database' as const,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }))
    )
  } catch (error) {
    return mapConnectionApiError(error, ROUTE_GET)
  }
}

interface CreateRequest {
  name: string
  host: string
  user: string
  password: string
  /** Source engine; omitted/absent defaults to 'clickhouse' in the store. */
  engine?: string
  /** Postgres-only fields (engine === 'postgres'). */
  port?: number
  database?: string
  sslmode?: string
  /** Optional PeerDB monitoring link (any engine). */
  peerdbApiUrl?: string
  peerdbAuthScheme?: string
  peerdbAuthSecret?: string
}

async function handlePost(request: Request): Promise<Response> {
  if (!getUserConnectionsServerConfig().dbStorageEnabled) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: 'User connections database storage is not enabled.',
      },
      501,
      ROUTE_POST
    )
  }

  let body: Partial<CreateRequest>
  try {
    body = (await request.json()) as Partial<CreateRequest>
  } catch {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'Request body must be valid JSON',
      },
      400,
      ROUTE_POST
    )
  }

  const { name, host, user, password, engine } = body
  if (
    !name?.trim() ||
    !host?.trim() ||
    !user?.trim() ||
    typeof password !== 'string'
  ) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'name, host, user, and password are required',
      },
      400,
      ROUTE_POST
    )
  }

  // Engine is optional (defaults to 'clickhouse' in the store); when present it
  // must be a known SourceEngine so junk can't reach persistence.
  if (engine !== undefined && !isSourceEngine(engine)) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message:
          'engine must be one of: clickhouse, clickhouse-cloud, postgres',
      },
      400,
      ROUTE_POST
    )
  }

  try {
    const userId = await resolveConnectionUserId()
    const store = await resolveConnectionStore()

    const owner = await resolveBillingOwner()

    // Active-subscription gate (cloud only): a signed-in cloud user must hold a
    // live subscription — ANY plan, including the $0 Free plan — before adding
    // their first host. This is the "pick a plan (Free is $0) to start" step;
    // resolveOwnerSubscription returns null when the owner has no live Polar
    // subscription. Runs BEFORE the host-limit check so a brand-new user is
    // routed to plan selection rather than a confusing limit error. OSS /
    // billing-not-configured skip this entirely (fail open — never gate a core
    // feature behind cloud mode).
    if (isCloudModeServer() && isBillingConfigured()) {
      const sub = await resolveOwnerSubscription(owner.id)
      if (!sub) {
        // Keep details.reason exactly 'subscription_required' — the onboarding
        // flow keys off it to route the user to plan selection.
        return createApiErrorResponse(
          {
            type: ApiErrorType.PermissionError,
            message:
              'An active plan is required before adding a host. Pick a plan on the billing page — Free is $0.',
            details: { reason: 'subscription_required' },
          },
          402,
          ROUTE_POST
        )
      }
    }

    // Engine-specific: SSRF guard + live connectivity test + the credential
    // envelope to persist. Postgres connects over raw TCP with its own guard
    // and a read-only `pg` probe; clickhouse / clickhouse-cloud share the HTTP
    // path.
    let input: CreateUserConnectionInput
    if (engine === 'postgres') {
      const port = body.port ?? 5432
      const database = (body.database ?? '').trim()
      const sslmode = body.sslmode
      if (!database) {
        return createApiErrorResponse(
          {
            type: ApiErrorType.ValidationError,
            message: 'database is required for a Postgres connection',
          },
          400,
          ROUTE_POST
        )
      }

      const ssrfError = await validatePostgresHost(host.trim(), port)
      if (ssrfError) {
        return createApiErrorResponse(
          { type: ApiErrorType.ValidationError, message: ssrfError },
          400,
          ROUTE_POST
        )
      }

      const pgConn = {
        host: host.trim(),
        port,
        user: user.trim(),
        password,
        database,
        sslmode,
      }
      try {
        await queryPostgres(pgConn, 'SELECT 1')
      } catch (err) {
        return createApiErrorResponse(
          { type: ApiErrorType.QueryError, message: formatPostgresError(err) },
          400,
          ROUTE_POST
        )
      }

      input = {
        name: name.trim(),
        // Display-only metadata; the real creds live in the encrypted payload.
        hostUrl: `postgres://${host.trim()}:${port}/${database}`,
        chUser: user.trim(),
        credentials: { kind: 'postgres', ...pgConn },
        engine,
      }
    } else {
      const credentials = {
        host: host.trim(),
        user: user.trim(),
        password,
      }

      const ssrfError = await validateHostUrl(credentials.host)
      if (ssrfError) {
        return createApiErrorResponse(
          { type: ApiErrorType.ValidationError, message: ssrfError },
          400,
          ROUTE_POST
        )
      }

      try {
        await queryConnection(credentials, 'SELECT 1')
      } catch (err) {
        return createApiErrorResponse(
          {
            type: ApiErrorType.QueryError,
            message:
              err instanceof Error ? err.message : 'Connection test failed',
          },
          400,
          ROUTE_POST
        )
      }

      input = {
        name: name.trim(),
        hostUrl: credentials.host,
        chUser: credentials.user,
        credentials,
        engine,
      }
    }

    // Optional PeerDB monitoring link (any engine): validate the scheme + shape
    // the fields, SSRF-guard the URL like a ClickHouse host, then fold into the
    // encrypted envelope. The secret lives only in the payload — GET never
    // returns it.
    const peerdb = buildPeerdbCredentialFields({
      apiUrl: body.peerdbApiUrl,
      scheme: body.peerdbAuthScheme,
      secret: body.peerdbAuthSecret,
    })
    if (peerdb.error) {
      return createApiErrorResponse(
        { type: ApiErrorType.ValidationError, message: peerdb.error },
        400,
        ROUTE_POST
      )
    }
    if (peerdb.fields.peerdbApiUrl) {
      const peerdbSsrf = await validateHostUrl(peerdb.fields.peerdbApiUrl)
      if (peerdbSsrf) {
        return createApiErrorResponse(
          {
            type: ApiErrorType.ValidationError,
            message: `PeerDB API URL: ${peerdbSsrf}`,
          },
          400,
          ROUTE_POST
        )
      }
      input.credentials = { ...input.credentials, ...peerdb.fields }
    }

    const created = await store.create(userId, input, {
      memberUserIds: [userId],
      limit: null,
    })

    if (owner.type === 'org') {
      await logEvent({
        orgId: owner.id,
        userId,
        event: 'connection.created',
        resource: created.id,
        action: 'create',
        result: 'success',
      })
    }

    // Outbound webhook bus (plan 44): fire-and-forget — NOT awaited, so a
    // slow/failing subscriber can never slow or fail this request. emitEvent
    // never throws. See lib/events/outbound-bus.ts's module docblock for why
    // this can't be `waitUntil`-backed instead.
    void emitEvent(userId, {
      id: crypto.randomUUID(),
      type: 'connection.created',
      occurred_at: new Date(created.createdAt).toISOString(),
      data: { id: created.id, name: created.name, hostId: created.hostId },
    })

    return createSuccessResponse({
      id: created.id,
      name: created.name,
      host: created.hostUrl,
      user: created.chUser,
      hostId: created.hostId,
      engine: created.engine,
      source: 'database' as const,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    })
  } catch (error) {
    return mapConnectionApiError(error, ROUTE_POST)
  }
}

export const Route = createFileRoute('/api/v1/user-connections')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handlePost as __handlePostForTests }
