/**
 * Health Webhook Proxy Endpoint
 * POST /api/v1/health/webhook
 *
 * Securely proxies Slack/Discord/etc. webhook requests from the server side to
 * bypass browser CORS preflight restrictions.
 *
 * SECURITY (SSRF): this endpoint makes the server fetch a caller-supplied URL,
 * so it is an SSRF sink. Every URL is run through `validateHostUrl` (the same
 * guard used for ClickHouse connections) which rejects private / loopback /
 * link-local / metadata targets (RFC1918 10/8, 172.16/12, 192.168/16,
 * 127.0.0.0/8, 169.254.0.0/16, ::1, IPv6 ULA fc00::/7, CGNAT, …) — both raw IP
 * literals and hostnames that resolve into those ranges. Errors are returned as
 * a generic 400 so we never leak internal DNS/resolution detail.
 *
 * Ported from apps/dashboard/app/api/v1/health/webhook/route.ts.
 * - Per-route auth (authorizeFeatureRequest, feature 'settings') restored:
 *   the global /api/v1 middleware is a public passthrough, so this route
 *   must self-enforce that anonymous callers cannot trigger the outbound
 *   fetch (see the write gate in handlePost below). Was previously dropped
 *   in favor of centralized middleware (#1397); that middleware turned out
 *   to be a passthrough for writes, so the gate is back.
 * - NextResponse replaced with standard Response / Response.json.
 * - @/lib/api/error-handler exists in this app and is imported directly.
 */

import { createFileRoute } from '@tanstack/react-router'

import { debug, error } from '@chm/logger'
import { createErrorResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import {
  type ResolveHostAddresses,
  validateHostUrl,
} from '@/lib/browser-connections/host-url'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'

const ROUTE_CONTEXT = {
  route: '/api/v1/health/webhook',
  method: 'POST',
} as const

/** Generic, non-leaky message for a blocked/invalid destination URL. */
const BLOCKED_URL_MESSAGE =
  'The webhook URL is not allowed. Use a public HTTPS endpoint.'

interface WebhookRequestBody {
  url?: string
  text?: string
  /**
   * Optional provider hint (e.g. "slack", "discord", "telegram", "pagerduty").
   * When present, `payload` is forwarded to the webhook verbatim instead of the
   * default `{ text, content }` wrapper — so callers can send provider-specific
   * bodies (Slack blocks, Discord embeds, PagerDuty events, …).
   */
  provider?: string
  /** Exact JSON body to forward when `provider` is set. */
  payload?: unknown
}

/** Injectable dependencies (tests override the DNS resolver + fetch). */
interface WebhookDeps {
  resolveHostAddresses?: ResolveHostAddresses
  fetchImpl?: typeof fetch
}

async function handlePost(
  request: Request,
  deps: WebhookDeps = {}
): Promise<Response> {
  // Write gate: this POST makes the server issue an outbound fetch to a
  // caller-supplied URL — a state-changing, SSRF-capable egress. The global
  // /api/v1 middleware is a public passthrough under provider='none' /
  // CHM_CLERK_PUBLIC_READ, so this route must self-enforce that anonymous
  // callers cannot trigger it. A valid `chm_` API key still authenticates
  // programmatic clients (e.g. alert integrations). Mirrors the
  // /api/v1/actions guard.
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  debug('[POST /api/v1/health/webhook] Proxying alert webhook')

  let body: WebhookRequestBody
  try {
    body = (await request.json()) as WebhookRequestBody
  } catch {
    return createErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'Request body must be valid JSON',
      },
      400,
      ROUTE_CONTEXT
    )
  }

  const { url, text, provider, payload } = body

  if (!url || typeof url !== 'string' || !url.startsWith('https://')) {
    return createErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'Missing or invalid "url": expected an HTTPS webhook URL',
      },
      400,
      ROUTE_CONTEXT
    )
  }

  // SSRF guard: block private / loopback / link-local / metadata destinations.
  // Reuses the shared ClickHouse connection guard so the block ranges stay in
  // one place. On a blocked/invalid host we return a generic 400 and log the
  // real reason server-side only (no leak of internal resolution detail).
  const ssrfError = await validateHostUrl(url, deps.resolveHostAddresses)
  if (ssrfError) {
    error(
      '[POST /api/v1/health/webhook] Blocked SSRF-unsafe webhook URL',
      new Error(ssrfError)
    )
    return createErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: BLOCKED_URL_MESSAGE,
      },
      400,
      ROUTE_CONTEXT
    )
  }

  // Determine the outgoing body. With a `provider` hint the caller controls the
  // exact JSON (forwarded verbatim); otherwise keep the backward-compatible
  // `{ text, content }` wrapper driven by `text`.
  const usesProvider =
    typeof provider === 'string' && provider.trim().length > 0

  let outgoingBody: unknown
  if (usesProvider) {
    if (payload === undefined || payload === null) {
      return createErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message:
            'Missing or invalid "payload": expected a JSON body when "provider" is set',
        },
        400,
        ROUTE_CONTEXT
      )
    }
    outgoingBody = payload
  } else {
    if (!text || typeof text !== 'string') {
      return createErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Missing or invalid "text": expected a string payload',
        },
        400,
        ROUTE_CONTEXT
      )
    }
    outgoingBody = { text, content: text }
  }

  debug(
    '[POST /api/v1/health/webhook] Proxying to:',
    `${url.substring(0, 40)}...`
  )

  const doFetch = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outgoingBody),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      error(
        '[POST /api/v1/health/webhook] Remote webhook error:',
        new Error(`Status ${res.status}`),
        { errText }
      )
      return createErrorResponse(
        {
          type: ApiErrorType.QueryError,
          message: `Remote webhook returned status ${res.status}: ${errText}`,
        },
        res.status,
        ROUTE_CONTEXT
      )
    }

    return Response.json({ success: true }, { status: 200 })
  } catch (fetchErr: unknown) {
    clearTimeout(timeout)
    error('[POST /api/v1/health/webhook] Webhook fetch exception:', fetchErr)
    return createErrorResponse(
      {
        type: ApiErrorType.NetworkError,
        message: `Failed to connect to remote webhook: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
      },
      502,
      ROUTE_CONTEXT
    )
  }
}

export const Route = createFileRoute('/api/v1/health/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handlePost as __handlePostForTests }
