/**
 * "Test PeerDB" endpoint.
 * POST /api/v1/peerdb/validate
 *
 * Validates a user-supplied PeerDB flow-api link from the connection form's
 * Advanced section: SSRF-guards the URL (same policy as ClickHouse hosts /
 * Postgres sources — http(s) only, no internal targets) and probes
 * `/v1/version` server-side with the supplied Basic/Bearer auth. The secret is
 * used only for this probe and never logged or echoed back.
 *
 * Always responds HTTP 200 with `{ ok, version?, error? }` (mirrors
 * `browser-connections/test`) so the client renders the outcome inline.
 *
 * A dedicated static route wins over the read-only splat proxy (`peerdb/$.ts`)
 * for this path.
 */

import { createFileRoute } from '@tanstack/react-router'

import { createValidationError } from '@/lib/api/error-handler'
import {
  checkRateLimitDurable,
  clientIpKey,
  getBrowserConnectionRateLimitPerMin,
  RATE_LIMIT_BINDING_BROWSER_CONN,
  rateLimitResponse,
} from '@/lib/api/rate-limiter'
import { validateHostUrl } from '@/lib/browser-connections/host-url'
import {
  buildPeerDBAuthHeader,
  parsePeerDBAuthScheme,
} from '@/lib/peerdb/peerdb-auth'

const ROUTE_CONTEXT = {
  route: '/api/v1/peerdb/validate',
  method: 'POST',
} as const

const PROBE_TIMEOUT_MS = 10_000

/**
 * IP-keyed rate limit guard — the same class of unauthenticated outbound
 * probe as `/api/v1/browser-connections/test` (#2978): this route dials an
 * attacker-supplied PeerDB URL (`/v1/version`) on every request. Shares the
 * `CHM_RATE_LIMIT_BROWSER_CONN` binding + 10/min getter (one budget class for
 * outbound-probe routes) but keys distinctly (`peerdb-validate:ip:`) so a
 * burst against one route doesn't consume a sibling's budget.
 */
async function checkPeerdbValidateRateLimit(
  request: Request
): Promise<Response | null> {
  const rl = await checkRateLimitDurable(
    `peerdb-validate:ip:${clientIpKey(request)}`,
    getBrowserConnectionRateLimitPerMin(),
    RATE_LIMIT_BINDING_BROWSER_CONN
  )
  return rl.allowed ? null : rateLimitResponse(rl.retryAfterSec)
}

interface ValidateRequest {
  apiUrl: string
  /** `basic` (default) or `bearer`. Ignored when no secret is supplied. */
  authScheme?: string
  /** Basic password or Bearer token; omit for an open flow-api. */
  secret?: string
}

interface ValidateResponse {
  ok: boolean
  version?: string
  error?: string
}

async function handlePost(request: Request): Promise<Response> {
  let body: Partial<ValidateRequest>
  try {
    body = (await request.json()) as Partial<ValidateRequest>
  } catch {
    return createValidationError(
      'Request body must be valid JSON',
      ROUTE_CONTEXT
    )
  }

  const apiUrl = body.apiUrl?.trim()
  if (!apiUrl) {
    return createValidationError(
      'Missing required field: apiUrl',
      ROUTE_CONTEXT
    )
  }

  // Rate limit BEFORE any outbound work — this route fetches an
  // attacker-supplied URL, so cap it like the browser-connections probe.
  const limited = await checkPeerdbValidateRateLimit(request)
  if (limited) return limited

  // http(s)-only + SSRF guard, identical to how ClickHouse host URLs are vetted.
  const ssrfError = await validateHostUrl(apiUrl)
  if (ssrfError) {
    return createValidationError(ssrfError, ROUTE_CONTEXT)
  }

  const secret = body.secret?.trim() || undefined
  const authScheme = secret ? parsePeerDBAuthScheme(body.authScheme) : undefined
  const baseUrl = apiUrl.replace(/\/+$/, '')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}/v1/version`, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...buildPeerDBAuthHeader({ authScheme, secret }),
      },
    })

    if (!response.ok) {
      const auth = response.status === 401 || response.status === 403
      const result: ValidateResponse = {
        ok: false,
        error: auth
          ? `Authentication failed (HTTP ${response.status}). Check the auth scheme and secret.`
          : `PeerDB API error ${response.status}: ${response.statusText}`,
      }
      return Response.json(result, { status: 200 })
    }

    const json = (await response.json().catch(() => ({}))) as {
      version?: string
    }
    const result: ValidateResponse = { ok: true, version: json.version }
    return Response.json(result, { status: 200 })
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    const result: ValidateResponse = {
      ok: false,
      error: aborted
        ? `PeerDB request timed out after ${PROBE_TIMEOUT_MS}ms`
        : `Failed to reach PeerDB: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
    }
    return Response.json(result, { status: 200 })
  } finally {
    clearTimeout(timeout)
  }
}

export const Route = createFileRoute('/api/v1/peerdb/validate')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})
