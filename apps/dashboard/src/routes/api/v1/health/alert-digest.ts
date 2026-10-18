/**
 * Time-window digest settings CRUD (feat #2663)
 *
 *   GET /api/v1/health/alert-digest   — read the digest on/off + window minutes
 *   PUT /api/v1/health/alert-digest   — save the digest on/off + window minutes
 *
 * Digest mode groups a burst of findings into ONE message per delivery target.
 * In-pass grouping is ALWAYS on and needs no config; this endpoint only governs
 * the OPTIONAL time-window mode (buffer non-critical findings, flush after N
 * minutes). Owner-scoped via {@link resolveConfigOwner} (shared with the
 * routes / channel-config APIs): self-hosted manages it with zero auth under the
 * OSS single-tenant owner `''`, cloud requires sign-in for writes. The store is
 * best-effort D1 — GET always returns 200 (falling back to the env value), and a
 * PUT with no alert state backend (D1 or Postgres) returns 501.
 */

import { createFileRoute } from '@tanstack/react-router'

import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import {
  getDigestSettings,
  resolveDigestSettings,
  setDigestSettings,
} from '@/lib/health/alert-digest-settings-store'
import {
  requiresSignInForWrite,
  resolveConfigOwner,
  SINGLE_TENANT_OWNER_ID,
} from '@/lib/health/alert-routing-auth'
import { getServerDigestWindowMinutes } from '@/lib/health/server-alert-config'

/** Same cap the store enforces — kept here so the API rejects loudly, too. */
const MAX_WINDOW_MINUTES = 1440

function jsonError(message: string, status: number): Response {
  return Response.json({ success: false, error: { message } }, { status })
}

async function handleGet(request: Request): Promise<Response> {
  // Public read: a caller with no provable owner sees the single-tenant
  // settings (an on/off flag and a window length, nothing secret).
  const owner = await resolveConfigOwner(request, 'user')
  const ownerId = owner instanceof Response ? SINGLE_TENANT_OWNER_ID : owner
  const [row, effective] = await Promise.all([
    getDigestSettings(ownerId),
    resolveDigestSettings(ownerId),
  ])
  const envWindowMinutes = getServerDigestWindowMinutes()
  return Response.json(
    {
      success: true,
      // Single value (#3497): saved row › digest.yaml › env › off.
      enabled: effective?.enabled ?? false,
      windowMinutes: effective?.windowMinutes ?? 0,
      hasRow: row !== null,
      envWindowMinutes,
      source: effective?.source ?? null,
    },
    { status: 200 }
  )
}

interface DigestBody {
  enabled?: unknown
  windowMinutes?: unknown
}

async function handlePut(request: Request): Promise<Response> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  const ownerId = await resolveConfigOwner(request, 'user')
  if (ownerId instanceof Response) return ownerId
  if (requiresSignInForWrite(ownerId)) {
    return jsonError('Sign in to edit digest settings.', 401)
  }

  let body: DigestBody
  try {
    body = (await request.json()) as DigestBody
  } catch {
    return jsonError('Request body must be valid JSON', 400)
  }

  const enabled = body.enabled === true
  const windowRaw = Number(body.windowMinutes)
  if (!Number.isFinite(windowRaw) || windowRaw < 0) {
    return jsonError('"windowMinutes" must be a non-negative number', 400)
  }
  const windowMinutes = Math.min(Math.floor(windowRaw), MAX_WINDOW_MINUTES)

  const saved = await setDigestSettings(ownerId, { enabled, windowMinutes })
  if (!saved) {
    return jsonError(
      'Digest settings storage is not configured (no D1 binding or Postgres DATABASE_URL) or the write failed.',
      501
    )
  }

  return Response.json({ success: true, ...saved }, { status: 200 })
}

export const Route = createFileRoute('/api/v1/health/alert-digest')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
      PUT: async ({ request }) => handlePut(request),
    },
  },
})

// Exported for unit tests only.
export { handleGet as __handleGetForTests, handlePut as __handlePutForTests }
