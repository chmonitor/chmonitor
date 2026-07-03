/**
 * Shared auth + error mapping for the MCP registry HTTP routes
 * (`/api/v1/mcp/servers` and the `/api/v1/mcp/probe` test-connection probe).
 */

import type { McpAuth, McpAuthKind, McpTransport } from './registration-store'

import { McpRegistryError } from './registration-store'
import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { ApiErrorType } from '@/lib/api/types'
import { isClerkAuthProvider } from '@/lib/auth/provider'
import { GUEST_USER_ID, resolveUserId } from '@/lib/conversation-store/auth'
import { ConversationStoreError } from '@/lib/conversation-store/types'

interface RouteContext {
  route: string
  method: string
}

/**
 * Resolve the user id the registry is scoped to.
 *
 * - Clerk configured + signed-in  → the Clerk user id (per-user isolation).
 * - Clerk configured, no session  → throws UNAUTHORIZED (mapped to 401).
 * - Clerk NOT configured (OSS)     → `'guest'` single-user scope, so a
 *   self-hosted deployment still works without an auth provider.
 */
export async function resolveRegistryUserId(request: Request): Promise<string> {
  if (!isClerkAuthProvider()) return GUEST_USER_ID
  return resolveUserId(request)
}

/** Map registry / auth errors to the shared API error response shape. */
export function mapRegistryError(
  error: unknown,
  context: RouteContext
): Response {
  if (error instanceof McpRegistryError) {
    const status =
      error.code === 'NOT_ENABLED'
        ? 501
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'VALIDATION'
            ? 400
            : error.code === 'ENCRYPTION_UNAVAILABLE'
              ? 501
              : 500
    const type =
      error.code === 'VALIDATION'
        ? ApiErrorType.ValidationError
        : ApiErrorType.PermissionError
    return createApiErrorResponse(
      { type, message: error.message },
      status,
      context
    )
  }

  if (error instanceof ConversationStoreError) {
    const status = error.code === 'UNAUTHORIZED' ? 401 : 500
    return createApiErrorResponse(
      { type: ApiErrorType.PermissionError, message: error.message },
      status,
      context
    )
  }

  return createApiErrorResponse(
    {
      type: ApiErrorType.QueryError,
      message: error instanceof Error ? error.message : 'Unknown error',
    },
    500,
    context
  )
}

// ---------------------------------------------------------------------------
// Request-body parsing (shared by servers.ts + probe.ts)
// ---------------------------------------------------------------------------

export function parseTransport(value: unknown): McpTransport {
  return value === 'sse' ? 'sse' : 'http'
}

export function parseAuthKind(value: unknown): McpAuthKind {
  return value === 'bearer' || value === 'header' ? value : 'none'
}

/** Build structured auth from raw request fields (no secret ⇒ no auth). */
export function buildRegistryAuth(
  kind: McpAuthKind,
  secret: string | undefined,
  headerName: string | undefined
): McpAuth {
  if (kind === 'bearer' && secret) return { kind: 'bearer', token: secret }
  if (kind === 'header' && secret) {
    return {
      kind: 'header',
      headerName: headerName || 'Authorization',
      value: secret,
    }
  }
  return { kind: 'none' }
}
