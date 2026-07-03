/**
 * MCP probe endpoint — POST /api/v1/mcp/probe
 *
 * Validates and test-connects to a user-supplied MCP endpoint (the
 * "Test connection" probe) so the UI can show real connection status and the
 * server's advertised tools BEFORE saving a registration — without persisting
 * anything. Optionally accepts `transport` + auth so the manager can test a
 * server exactly as it will be loaded (bearer token / custom header).
 *
 * This is the single test-before-save implementation: it delegates to
 * {@link validateServer} (shared with `/api/v1/mcp/servers` POST and the agent
 * loader), which SSRF-guards the URL, opens the SSRF-pinned client, lists the
 * real tools, and always closes the client.
 *
 * Auth: same as the agent route (authorizeAgentApiRequest).
 */

import { createFileRoute } from '@tanstack/react-router'

import { validateServer } from '@/lib/ai/agent/mcp/connect-custom-servers'
import {
  buildRegistryAuth,
  parseAuthKind,
  parseTransport,
} from '@/lib/ai/agent/mcp/registry-http'
import { authorizeAgentApiRequest } from '@/lib/auth/agent-api-auth'

interface ProbeRequestBody {
  endpoint: string
  name?: string
  transport?: unknown
  authKind?: unknown
  authSecret?: unknown
  authHeaderName?: unknown
}

interface ProbeResponse {
  status: 'connected' | 'error'
  toolCount: number
  tools: string[]
  error?: string
}

async function handlePost(request: Request): Promise<Response> {
  const authResponse = await authorizeAgentApiRequest(request)
  if (authResponse) return authResponse

  let body: ProbeRequestBody
  try {
    const raw = await request.json()
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as Record<string, unknown>).endpoint !== 'string'
    ) {
      throw new Error('INVALID_PAYLOAD')
    }
    body = raw as ProbeRequestBody
  } catch {
    return Response.json(
      { error: 'Invalid JSON payload — "endpoint" (string) is required' },
      { status: 400 }
    )
  }

  const endpoint = body.endpoint.trim()
  const name = typeof body.name === 'string' ? body.name.trim() : 'probe'
  const transport = parseTransport(body.transport)
  const authKind = parseAuthKind(body.authKind)
  const authSecret =
    typeof body.authSecret === 'string' ? body.authSecret : undefined
  const authHeaderName =
    typeof body.authHeaderName === 'string' ? body.authHeaderName : undefined
  const auth = buildRegistryAuth(authKind, authSecret, authHeaderName)

  const result = await validateServer({
    id: 'probe',
    name: name || 'probe',
    endpoint,
    transport,
    auth,
  })

  const responseBody: ProbeResponse = result.ok
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

  return Response.json(responseBody)
}

export const Route = createFileRoute('/api/v1/mcp/probe')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})
