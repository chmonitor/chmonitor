/**
 * Live connection status for one registered MCP server —
 * POST /api/v1/mcp/servers/$id/probe
 *
 * Unlike `/api/v1/mcp/probe` (test-before-save, takes the endpoint + auth in
 * the request body), this probes an ALREADY-REGISTERED server by id: it loads
 * the user's stored registration (decrypting its secret server-side — the
 * client never has it) and re-validates the connection. Used by the MCP
 * servers settings tab to show a live connected/error status per row instead
 * of only the timestamp from the last manual "Test connection" click.
 */

import { createFileRoute } from '@tanstack/react-router'

import { validateServer } from '@/lib/ai/agent/mcp/connect-custom-servers'
import {
  isMcpRegistryEnabled,
  McpRegistryError,
  mcpRegistrationStore,
} from '@/lib/ai/agent/mcp/registration-store'
import {
  mapRegistryError,
  resolveRegistryUserId,
} from '@/lib/ai/agent/mcp/registry-http'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'

const CTX = { route: '/api/v1/mcp/servers/$id/probe', method: 'POST' }

interface ProbeResponse {
  status: 'connected' | 'error'
  toolCount: number
  tools: string[]
  error?: string
}

async function handlePost(
  request: Request,
  id: string | undefined
): Promise<Response> {
  if (!id) {
    return mapRegistryError(
      new McpRegistryError('id is required', 'VALIDATION'),
      CTX
    )
  }
  if (!isMcpRegistryEnabled()) {
    return mapRegistryError(
      new McpRegistryError(
        'MCP server registry is not enabled on this deployment.',
        'NOT_ENABLED'
      ),
      CTX
    )
  }

  try {
    const userId = await resolveRegistryUserId(request)
    const input = await mcpRegistrationStore.getConnectInput(userId, id)
    if (!input) {
      return mapRegistryError(
        new McpRegistryError('Registration not found', 'NOT_FOUND'),
        CTX
      )
    }

    const result = await validateServer({
      id: input.id,
      name: input.name,
      endpoint: input.url,
      transport: input.transport,
      auth: input.auth,
    })

    const body: ProbeResponse = result.ok
      ? {
          status: 'connected',
          toolCount: result.tools?.length ?? 0,
          tools: result.tools ?? [],
        }
      : {
          status: 'error',
          toolCount: 0,
          tools: [],
          ...(result.error !== undefined ? { error: result.error } : {}),
        }

    return createSuccessResponse(body)
  } catch (error) {
    return mapRegistryError(error, CTX)
  }
}

export const Route = createFileRoute('/api/v1/mcp/servers/$id/probe')({
  server: {
    handlers: {
      POST: async ({ request, params }) => handlePost(request, params.id),
    },
  },
})
