/**
 * API Key Issuance Endpoint
 * POST /api/v1/auth/api-key
 *
 * Mints a signed API key for MCP / CLI use. Authorize with EITHER:
 *  - `Authorization: Bearer $CHM_API_KEY_SECRET` (admin issuance; sub from body label)
 *  - an authenticated Clerk/proxy session (user-scoped; sub = userId)
 *
 * Optional body: `{ label?, days?, scopes? }`.
 * Returns `{ data: { apiKey, sub, scopes, expiresInDays } }`.
 */

import { createFileRoute } from '@tanstack/react-router'

import {
  ALL_API_KEY_SCOPES,
  type ApiKeyScope,
  getBearerToken,
  issueApiKey,
} from '@chm/mcp-server/auth'
import { getAuthProvider } from '@/lib/auth/provider'
import { resolveServerAuthProvider } from '@/lib/auth/providers'

const MAX_API_KEY_DAYS = 365
const ALLOWED_SCOPES = new Set<string>(ALL_API_KEY_SCOPES)

function getSecret(): string | null {
  return process.env.CHM_API_KEY_SECRET ?? null
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  if (aBytes.length !== bBytes.length) return false

  let diff = 0
  for (let index = 0; index < aBytes.length; index += 1) {
    diff |= aBytes[index] ^ bBytes[index]
  }

  return diff === 0
}

function normalizeScopes(raw: unknown): ApiKeyScope[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const filtered = [
    ...new Set(
      raw
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => ALLOWED_SCOPES.has(s))
    ),
  ] as ApiKeyScope[]
  return filtered.length > 0 ? filtered : undefined
}

async function resolveIssuerSub(
  request: Request,
  secret: string
): Promise<{ sub: string; via: 'secret' | 'session' } | Response> {
  const token = getBearerToken(request.headers.get('authorization'))
  if (token && timingSafeEqualString(token, secret)) {
    return { sub: 'cli', via: 'secret' }
  }

  let provider: ReturnType<typeof getAuthProvider>
  try {
    provider = getAuthProvider()
  } catch {
    return Response.json(
      { error: 'Invalid auth provider configuration' },
      { status: 500 }
    )
  }

  if (provider === 'none') {
    return Response.json(
      {
        error:
          'Unauthorized: provide CHM_API_KEY_SECRET as Bearer token or sign in',
      },
      { status: 401 }
    )
  }

  const auth =
    await resolveServerAuthProvider(provider).authenticateRequest(request)
  const userId = auth.subject ?? auth.principal?.subject
  if (!auth.authenticated || !userId) {
    return Response.json(
      {
        error:
          'Unauthorized: provide CHM_API_KEY_SECRET as Bearer token or sign in',
      },
      { status: 401 }
    )
  }

  return { sub: userId, via: 'session' }
}

async function handlePost(request: Request): Promise<Response> {
  const secret = getSecret()
  if (!secret) {
    return Response.json(
      { error: 'CHM_API_KEY_SECRET is not configured' },
      { status: 503 }
    )
  }

  const issuer = await resolveIssuerSub(request, secret)
  if (issuer instanceof Response) return issuer

  try {
    const rawBody = await request.text()
    let payload: Record<string, unknown> = {}
    if (rawBody.trim()) {
      try {
        const body = JSON.parse(rawBody) as unknown
        payload =
          body && typeof body === 'object'
            ? (body as Record<string, unknown>)
            : {}
      } catch {
        return Response.json(
          { error: 'Request body must be valid JSON' },
          { status: 400 }
        )
      }
    }

    const label = typeof payload.label === 'string' ? payload.label : 'cli'
    const days = Number(payload.days ?? 30)
    if (!Number.isInteger(days) || days < 1 || days > MAX_API_KEY_DAYS) {
      return Response.json(
        { error: `days must be an integer from 1 to ${MAX_API_KEY_DAYS}` },
        { status: 400 }
      )
    }

    const scopes = normalizeScopes(payload.scopes)
    const sub = issuer.via === 'secret' ? label : issuer.sub
    const apiKey = await issueApiKey(sub, days, scopes)
    const stampedScopes = scopes ?? [...ALL_API_KEY_SCOPES]

    return Response.json({
      data: {
        apiKey,
        sub,
        scopes: stampedScopes,
        expiresInDays: days,
      },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to issue key' },
      { status: 500 }
    )
  }
}

export const Route = createFileRoute('/api/v1/auth/api-key')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})
