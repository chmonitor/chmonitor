/**
 * MCP server registry API — /api/v1/mcp/servers
 *
 *   GET    — list the signed-in user's registered MCP servers (metadata only,
 *            never the stored secret).
 *   POST   — validate connectivity + capabilities, then persist a new
 *            registration (scoped to the user). Rejects an unreachable server
 *            rather than storing a dishonest "connected" claim.
 *   PATCH  — rename / enable / disable one of the user's registrations.
 *   DELETE — remove one of the user's registrations (`?id=`).
 *
 * All operations are strictly user-scoped (see registration-store.ts) and reuse
 * the shared API error/response builders. Requires the D1 registry to be
 * enabled; otherwise returns 501 (like user-connections DB storage).
 *
 * See plans/43-mcp-custom-server-registry.md.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { McpRegistration } from '@/lib/ai/agent/mcp/registration-store'

import { validateServer } from '@/lib/ai/agent/mcp/connect-custom-servers'
import {
  isMcpRegistryEnabled,
  McpRegistryError,
  mcpRegistrationStore,
} from '@/lib/ai/agent/mcp/registration-store'
import {
  buildRegistryAuth,
  mapRegistryError,
  parseAuthKind,
  parseTransport,
  resolveRegistryUserId,
} from '@/lib/ai/agent/mcp/registry-http'
import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'

const ROUTE = '/api/v1/mcp/servers'
const CTX = (method: string) => ({ route: ROUTE, method })

function notEnabledResponse(method: string): Response {
  return createApiErrorResponse(
    {
      type: ApiErrorType.PermissionError,
      message:
        'MCP server registry is not enabled (no CHM_CLOUD_D1 binding on this deployment).',
    },
    501,
    CTX(method)
  )
}

function validationError(message: string, method: string): Response {
  return createApiErrorResponse(
    { type: ApiErrorType.ValidationError, message },
    400,
    CTX(method)
  )
}

/** Public DTO — strips the owner id and NEVER carries the secret. */
function toDto(reg: McpRegistration) {
  return {
    id: reg.id,
    name: reg.name,
    url: reg.url,
    transport: reg.transport,
    authKind: reg.authKind,
    authHeaderName: reg.authHeaderName,
    hasSecret: reg.hasSecret,
    enabled: reg.enabled,
    capabilities: reg.capabilities,
    lastValidatedAt: reg.lastValidatedAt,
    createdAt: reg.createdAt,
    updatedAt: reg.updatedAt,
  }
}

async function handleGet(request: Request): Promise<Response> {
  if (!isMcpRegistryEnabled()) return notEnabledResponse('GET')
  try {
    const userId = await resolveRegistryUserId(request)
    const servers = await mcpRegistrationStore.listForUser(userId)
    return createSuccessResponse(servers.map(toDto))
  } catch (error) {
    return mapRegistryError(error, CTX('GET'))
  }
}

interface CreateBody {
  name?: unknown
  url?: unknown
  transport?: unknown
  authKind?: unknown
  authSecret?: unknown
  authHeaderName?: unknown
}

async function handlePost(request: Request): Promise<Response> {
  if (!isMcpRegistryEnabled()) return notEnabledResponse('POST')

  let body: CreateBody
  try {
    body = (await request.json()) as CreateBody
  } catch {
    return validationError('Request body must be valid JSON', 'POST')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const transport = parseTransport(body.transport)
  const authKind = parseAuthKind(body.authKind)
  const authSecret =
    typeof body.authSecret === 'string' ? body.authSecret : undefined
  const authHeaderName =
    typeof body.authHeaderName === 'string'
      ? body.authHeaderName.trim()
      : undefined

  if (!name) return validationError('name is required', 'POST')
  if (!url) return validationError('url is required', 'POST')
  if (authKind !== 'none' && !authSecret) {
    return validationError(
      `authSecret is required for authKind "${authKind}"`,
      'POST'
    )
  }
  if (authKind === 'header' && !authHeaderName) {
    return validationError(
      'authHeaderName is required for authKind "header"',
      'POST'
    )
  }

  try {
    const userId = await resolveRegistryUserId(request)

    // Validate connectivity + capabilities BEFORE persisting — honest claims:
    // an unreachable / SSRF-blocked server is rejected, not stored as "ok".
    const auth = buildRegistryAuth(authKind, authSecret, authHeaderName)
    const probe = await validateServer({
      id: 'probe',
      name,
      endpoint: url,
      transport,
      auth,
    })
    if (!probe.ok) {
      return validationError(
        probe.error ?? 'Could not connect to the MCP server',
        'POST'
      )
    }

    const id = crypto.randomUUID()
    const written = await mcpRegistrationStore.upsert({
      id,
      userId,
      name,
      url,
      transport,
      authKind,
      authSecret,
      authHeaderName: authKind === 'header' ? authHeaderName : null,
      enabled: true,
      capabilities: probe.tools ?? [],
      lastValidatedAt: Date.now(),
    })
    if (!written.written) {
      throw new McpRegistryError('Failed to persist registration', 'VALIDATION')
    }

    const created = await mcpRegistrationStore.get(userId, id)
    return createSuccessResponse({
      ...(created ? toDto(created) : { id, name, url }),
      validatedTools: probe.tools ?? [],
    })
  } catch (error) {
    return mapRegistryError(error, CTX('POST'))
  }
}

interface PatchBody {
  id?: unknown
  name?: unknown
  enabled?: unknown
}

async function handlePatch(request: Request): Promise<Response> {
  if (!isMcpRegistryEnabled()) return notEnabledResponse('PATCH')

  let body: PatchBody
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return validationError('Request body must be valid JSON', 'PATCH')
  }

  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return validationError('id is required', 'PATCH')

  const name =
    typeof body.name === 'string' && body.name.trim().length > 0
      ? body.name.trim()
      : undefined
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined
  if (name === undefined && enabled === undefined) {
    return validationError(
      'Nothing to update (name or enabled required)',
      'PATCH'
    )
  }

  try {
    const userId = await resolveRegistryUserId(request)
    const res = await mcpRegistrationStore.patch(userId, id, { name, enabled })
    if (!res.updated) {
      return mapRegistryError(
        new McpRegistryError('Registration not found', 'NOT_FOUND'),
        CTX('PATCH')
      )
    }
    const updated = await mcpRegistrationStore.get(userId, id)
    return createSuccessResponse(updated ? toDto(updated) : { id })
  } catch (error) {
    return mapRegistryError(error, CTX('PATCH'))
  }
}

async function handleDelete(request: Request): Promise<Response> {
  if (!isMcpRegistryEnabled()) return notEnabledResponse('DELETE')

  const id = new URL(request.url).searchParams.get('id')?.trim() ?? ''
  if (!id) return validationError('id query parameter is required', 'DELETE')

  try {
    const userId = await resolveRegistryUserId(request)
    const res = await mcpRegistrationStore.remove(userId, id)
    if (!res.deleted) {
      return mapRegistryError(
        new McpRegistryError('Registration not found', 'NOT_FOUND'),
        CTX('DELETE')
      )
    }
    return createSuccessResponse({ id, deleted: true })
  } catch (error) {
    return mapRegistryError(error, CTX('DELETE'))
  }
}

export const Route = createFileRoute('/api/v1/mcp/servers')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
      POST: async ({ request }) => handlePost(request),
      PATCH: async ({ request }) => handlePatch(request),
      DELETE: async ({ request }) => handleDelete(request),
    },
  },
})
