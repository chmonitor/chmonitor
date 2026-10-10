/**
 * /api/v1/agents/anyrouter/token — the signed-in user's stored AnyRouter token.
 *
 * - GET    → `{ connected: boolean, expiresAt: number | null }`. Never returns
 *            the token.
 * - PUT    → body `{ token: string, expiresAt?: number | null }` (epoch ms).
 *            Encrypts and saves it so the agent can use it on any device.
 *            → `{ connected: true, expiresAt }`.
 * - DELETE → removes it (sign-out). Idempotent. → `{ connected: false, expiresAt: null }`.
 *
 * 404 when `CHM_AGENT_ANYROUTER_SIGNIN_ENABLED` is off. 401 for anonymous
 * callers (guests keep their token in the browser only). 503 when token
 * storage is unavailable (no D1 binding or no encryption key — fail closed).
 * The token value is never logged.
 */

import { createFileRoute } from '@tanstack/react-router'

import { parseByokApiKey } from '@/lib/ai/agent/byok'
import {
  deleteUserProviderToken,
  getUserProviderTokenStatus,
  saveUserProviderToken,
  UserTokenStoreError,
} from '@/lib/ai/agent/user-token-store'
import {
  anyRouterSigninDisabledResponse,
  isAnyRouterSigninEnabled,
} from '@/lib/ai/anyrouter-signin-flag'
import { resolveUserId } from '@/lib/conversation-store/auth'
import { ConversationStoreError } from '@/lib/conversation-store/types'

const PROVIDER = 'anyrouter'
const NO_STORE = { 'Cache-Control': 'no-store' }

function jsonError(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: NO_STORE }
  )
}

function mapError(error: unknown): Response {
  if (
    error instanceof ConversationStoreError &&
    error.code === 'UNAUTHORIZED'
  ) {
    return jsonError(
      'unauthorized',
      'Sign in to store your AnyRouter token.',
      401
    )
  }
  if (error instanceof UserTokenStoreError) {
    console.error(`[anyrouter-token] store error: ${error.code}`)
    return jsonError(
      'token_storage_unavailable',
      'AnyRouter token storage is not available on this deployment.',
      503
    )
  }
  console.error(
    '[anyrouter-token] unexpected error:',
    error instanceof Error ? error.name : typeof error
  )
  return jsonError('internal_error', 'Failed to update AnyRouter token.', 500)
}

function parseExpiresAt(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return undefined
  }
  return Math.trunc(raw)
}

async function handleGet(): Promise<Response> {
  if (!isAnyRouterSigninEnabled()) return anyRouterSigninDisabledResponse()
  try {
    const userId = await resolveUserId()
    const status = await getUserProviderTokenStatus(userId, PROVIDER)
    return Response.json(status, { headers: NO_STORE })
  } catch (error) {
    return mapError(error)
  }
}

async function handlePut(request: Request): Promise<Response> {
  if (!isAnyRouterSigninEnabled()) return anyRouterSigninDisabledResponse()
  try {
    const userId = await resolveUserId()

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('invalid_json', 'Invalid JSON payload', 400)
    }
    const record =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)
        : {}
    const token = parseByokApiKey(record.token)
    if (!token) {
      return jsonError(
        'invalid_token',
        'A valid AnyRouter token is required.',
        400
      )
    }
    const expiresAt = parseExpiresAt(record.expiresAt)
    if (expiresAt === undefined) {
      return jsonError(
        'invalid_expires_at',
        'expiresAt must be epoch milliseconds or null.',
        400
      )
    }
    if (expiresAt !== null && expiresAt <= Date.now()) {
      return jsonError(
        'token_expired',
        'This AnyRouter token has already expired.',
        400
      )
    }

    await saveUserProviderToken(userId, PROVIDER, token, expiresAt)
    return Response.json({ connected: true, expiresAt }, { headers: NO_STORE })
  } catch (error) {
    return mapError(error)
  }
}

async function handleDelete(): Promise<Response> {
  if (!isAnyRouterSigninEnabled()) return anyRouterSigninDisabledResponse()
  try {
    const userId = await resolveUserId()
    await deleteUserProviderToken(userId, PROVIDER)
    return Response.json(
      { connected: false, expiresAt: null },
      { headers: NO_STORE }
    )
  } catch (error) {
    return mapError(error)
  }
}

export const Route = createFileRoute('/api/v1/agents/anyrouter/token')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      PUT: async ({ request }) => handlePut(request),
      DELETE: async () => handleDelete(),
    },
  },
})

export {
  handleDelete as __handleDeleteForTests,
  handleGet as __handleGetForTests,
  handlePut as __handlePutForTests,
}
