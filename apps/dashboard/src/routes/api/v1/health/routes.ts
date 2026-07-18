/**
 * Per-rule / per-host alert routing CRUD (plans/30-per-rule-alert-routing.md)
 *
 *   GET    /api/v1/health/routes            — list the caller's routes
 *   POST   /api/v1/health/routes             — create a route
 *   DELETE /api/v1/health/routes?id=<id>     — delete a route by id
 *
 * Owner-scoped via {@link resolveAlertRoutingOwnerId} — see
 * `lib/health/alert-routing-auth.ts` for the fail-open (self-hosted) /
 * auth-gated-write (cloud) split. The underlying store
 * (`lib/health/alert-routing.ts`) is best-effort D1: it degrades to `[]` /
 * `null` rather than throwing when D1 isn't configured, so GET always
 * returns 200 with a (possibly empty) list instead of a 5xx.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { AlertRouteProvider } from '@/lib/health/alert-routing'

import { validateHostUrl } from '@/lib/browser-connections/host-url'
import {
  createRoute,
  deleteRoute,
  listRoutes,
} from '@/lib/health/alert-routing'
import {
  requiresSignInForWrite,
  resolveAlertRoutingOwnerId,
} from '@/lib/health/alert-routing-auth'
import { PAGERDUTY_EVENTS_API_URL } from '@/lib/health/pagerduty-config'

function jsonError(message: string, status: number): Response {
  return Response.json({ success: false, error: { message } }, { status })
}

/**
 * Mask a PagerDuty routing key for API responses — unlike a Slack/Discord
 * `channelUrl` (whose secret already lives openly in the URL path by
 * convention), a routing key is a bare secret with no other identifying
 * shape, so it is never returned in full once stored (plan 34's "secret at
 * rest, like connection secrets"). Shows only the last 4 characters.
 */
function maskRoutingKey(key: string): string {
  if (key.length <= 4) return '••••'
  return `••••${key.slice(-4)}`
}

function toPublicRoute(route: Awaited<ReturnType<typeof listRoutes>>[number]) {
  return {
    id: route.id,
    matchRule: route.matchRule,
    matchHost: route.matchHost,
    channelUrl: route.channelUrl,
    enabled: route.enabled,
    createdAt: route.createdAt,
    provider: route.provider,
    serviceName: route.serviceName,
    routingKeyMasked: route.routingKey
      ? maskRoutingKey(route.routingKey)
      : null,
    // Telegram (#2655): the bot token is a bare secret (like a PagerDuty
    // routing key), never returned in full once stored — only the last 4
    // chars. The chat id is not a secret and is returned as-is so the UI can
    // show which chat a route targets.
    telegramChatId: route.telegramChatId,
    telegramBotTokenMasked: route.telegramBotToken
      ? maskRoutingKey(route.telegramBotToken)
      : null,
    // ntfy (#2657): the topic URL is not a secret (its secret, if any, is the
    // access token) and is returned as-is so the UI can show which topic a
    // route targets; the optional token IS a bare secret, masked like the
    // Telegram bot token.
    ntfyUrl: route.ntfyUrl,
    ntfyTokenMasked: route.ntfyToken ? maskRoutingKey(route.ntfyToken) : null,
    // Pushover (#2659): the application token is a bare secret (like the
    // Telegram bot token), never returned in full once stored. The user/group
    // key is not a secret on its own — like the Telegram chat id — and is
    // returned as-is so the UI can show which recipient a route targets.
    pushoverUser: route.pushoverUser,
    pushoverTokenMasked: route.pushoverToken
      ? maskRoutingKey(route.pushoverToken)
      : null,
    // Per-route severity floor (#2661): `null` = inherit the channel/global
    // gate. Not a secret — returned as-is so the UI can show/edit it.
    minSeverity: route.minSeverity,
  }
}

async function handleGet(): Promise<Response> {
  const ownerId = await resolveAlertRoutingOwnerId()
  const routes = await listRoutes(ownerId)
  return Response.json(
    { success: true, routes: routes.map(toPublicRoute) },
    { status: 200 }
  )
}

interface CreateRouteBody {
  matchRule?: unknown
  matchHost?: unknown
  channelUrl?: unknown
  enabled?: unknown
  /**
   * `'webhook'` (default), `'pagerduty'` (plan 34), `'telegram'` (#2655),
   * `'ntfy'` (#2657), or `'pushover'` (#2659).
   */
  provider?: unknown
  /** PagerDuty-only: display label for the service. */
  serviceName?: unknown
  /** PagerDuty-only: the service's Events API v2 integration/routing key. */
  routingKey?: unknown
  /** Telegram-only: the Bot API token (a secret). */
  telegramBotToken?: unknown
  /** Telegram-only: the target chat id. */
  telegramChatId?: unknown
  /** ntfy-only: the topic URL (SSRF-validated, HTTPS-only). */
  ntfyUrl?: unknown
  /** ntfy-only: the optional access token (a secret). */
  ntfyToken?: unknown
  /** Pushover-only: the application API token (a secret). */
  pushoverToken?: unknown
  /** Pushover-only: the target user/group key. */
  pushoverUser?: unknown
  /** Optional per-route severity floor: `'warning'` | `'critical'` (#2661). */
  minSeverity?: unknown
}

async function handlePost(request: Request): Promise<Response> {
  const ownerId = await resolveAlertRoutingOwnerId()
  if (requiresSignInForWrite(ownerId)) {
    return jsonError('Sign in to create alert routes.', 401)
  }

  let body: CreateRouteBody
  try {
    body = (await request.json()) as CreateRouteBody
  } catch {
    return jsonError('Request body must be valid JSON', 400)
  }

  const provider: AlertRouteProvider =
    body.provider === 'pagerduty'
      ? 'pagerduty'
      : body.provider === 'telegram'
        ? 'telegram'
        : body.provider === 'ntfy'
          ? 'ntfy'
          : body.provider === 'pushover'
            ? 'pushover'
            : 'webhook'

  const matchRule =
    typeof body.matchRule === 'string' && body.matchRule.trim()
      ? body.matchRule.trim()
      : '*'
  const matchHost =
    typeof body.matchHost === 'string' && body.matchHost.trim()
      ? body.matchHost.trim()
      : '*'
  const enabled = body.enabled !== false
  // Optional per-route severity floor (#2661); anything but the two valid
  // literals means "inherit the channel/global gate" (null).
  const minSeverity: 'warning' | 'critical' | null =
    body.minSeverity === 'warning' || body.minSeverity === 'critical'
      ? body.minSeverity
      : null

  if (provider === 'pagerduty') {
    const routingKey =
      typeof body.routingKey === 'string' ? body.routingKey.trim() : ''
    if (!routingKey) {
      return jsonError(
        'Missing required "routingKey": a PagerDuty service integration/routing key',
        400
      )
    }
    const serviceName =
      typeof body.serviceName === 'string' ? body.serviceName.trim() : ''

    // The Events API v2 endpoint is fixed for every PagerDuty service — not
    // caller-supplied, so there is no new SSRF sink here (unlike the
    // webhook path below, which fetches an arbitrary operator-supplied URL).
    const created = await createRoute({
      ownerId,
      matchRule,
      matchHost,
      channelUrl: PAGERDUTY_EVENTS_API_URL,
      enabled,
      provider: 'pagerduty',
      serviceName: serviceName || null,
      routingKey,
      minSeverity,
    })

    if (!created) {
      return jsonError(
        'Alert routing storage is not configured (no D1 binding) or the write failed.',
        501
      )
    }

    return Response.json(
      { success: true, route: toPublicRoute(created) },
      { status: 201 }
    )
  }

  if (provider === 'telegram') {
    const telegramBotToken =
      typeof body.telegramBotToken === 'string'
        ? body.telegramBotToken.trim()
        : ''
    const telegramChatId =
      typeof body.telegramChatId === 'string' ? body.telegramChatId.trim() : ''
    if (!telegramBotToken || !telegramChatId) {
      return jsonError(
        'Missing required "telegramBotToken" and/or "telegramChatId" for a Telegram route',
        400
      )
    }

    // The Telegram Bot API endpoint host is fixed (`api.telegram.org`) — only
    // the token in the path varies — so there is no caller-supplied SSRF sink
    // here (unlike the webhook path below). `channelUrl` stays empty; the
    // sweep builds the outbound URL from the token at send time.
    const created = await createRoute({
      ownerId,
      matchRule,
      matchHost,
      channelUrl: '',
      enabled,
      provider: 'telegram',
      telegramBotToken,
      telegramChatId,
      minSeverity,
    })

    if (!created) {
      return jsonError(
        'Alert routing storage is not configured (no D1 binding) or the write failed.',
        501
      )
    }

    return Response.json(
      { success: true, route: toPublicRoute(created) },
      { status: 201 }
    )
  }

  if (provider === 'ntfy') {
    const ntfyUrl = typeof body.ntfyUrl === 'string' ? body.ntfyUrl.trim() : ''
    const ntfyToken =
      typeof body.ntfyToken === 'string' ? body.ntfyToken.trim() : ''
    if (!ntfyUrl || !ntfyUrl.startsWith('https://')) {
      return jsonError(
        'Missing or invalid "ntfyUrl": expected an HTTPS ntfy topic URL',
        400
      )
    }

    // Unlike Telegram (fixed api.telegram.org host), an ntfy topic URL is
    // caller-supplied — a real SSRF sink — so it goes through the same guard
    // the generic webhook path uses (`validateHostUrl`) before being stored.
    const ssrfError = await validateHostUrl(ntfyUrl)
    if (ssrfError) {
      return jsonError(ssrfError, 400)
    }

    const created = await createRoute({
      ownerId,
      matchRule,
      matchHost,
      channelUrl: '',
      enabled,
      provider: 'ntfy',
      ntfyUrl,
      ntfyToken: ntfyToken || null,
      minSeverity,
    })

    if (!created) {
      return jsonError(
        'Alert routing storage is not configured (no D1 binding) or the write failed.',
        501
      )
    }

    return Response.json(
      { success: true, route: toPublicRoute(created) },
      { status: 201 }
    )
  }

  if (provider === 'pushover') {
    const pushoverToken =
      typeof body.pushoverToken === 'string' ? body.pushoverToken.trim() : ''
    const pushoverUser =
      typeof body.pushoverUser === 'string' ? body.pushoverUser.trim() : ''
    if (!pushoverToken || !pushoverUser) {
      return jsonError(
        'Missing required "pushoverToken" and/or "pushoverUser" for a Pushover route',
        400
      )
    }

    // The Pushover Messages API endpoint is fixed (`api.pushover.net`) —
    // token/user travel in the body, not the URL — so there is no
    // caller-supplied SSRF sink here (unlike the webhook path below).
    // `channelUrl` stays empty; the sweep posts to the fixed endpoint.
    const created = await createRoute({
      ownerId,
      matchRule,
      matchHost,
      channelUrl: '',
      enabled,
      provider: 'pushover',
      pushoverToken,
      pushoverUser,
      minSeverity,
    })

    if (!created) {
      return jsonError(
        'Alert routing storage is not configured (no D1 binding) or the write failed.',
        501
      )
    }

    return Response.json(
      { success: true, route: toPublicRoute(created) },
      { status: 201 }
    )
  }

  const channelUrl =
    typeof body.channelUrl === 'string' ? body.channelUrl.trim() : ''
  if (!channelUrl || !channelUrl.startsWith('https://')) {
    return jsonError(
      'Missing or invalid "channelUrl": expected an HTTPS endpoint',
      400
    )
  }

  // Reuse the same SSRF guard the outbound webhook-subscriptions create path
  // uses (`validateHostUrl`) — never introduce a new unguarded outbound
  // destination. Delivery re-validates on every send via the sweep's
  // existing `postWebhook`, this just fails fast with a clear error.
  const ssrfError = await validateHostUrl(channelUrl)
  if (ssrfError) {
    return jsonError(ssrfError, 400)
  }

  const created = await createRoute({
    ownerId,
    matchRule,
    matchHost,
    channelUrl,
    enabled,
    provider: 'webhook',
    minSeverity,
  })

  if (!created) {
    return jsonError(
      'Alert routing storage is not configured (no D1 binding) or the write failed.',
      501
    )
  }

  return Response.json(
    { success: true, route: toPublicRoute(created) },
    { status: 201 }
  )
}

async function handleDelete(request: Request): Promise<Response> {
  const ownerId = await resolveAlertRoutingOwnerId()
  if (requiresSignInForWrite(ownerId)) {
    return jsonError('Sign in to delete alert routes.', 401)
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return jsonError('Missing required query param "id"', 400)
  }

  const deleted = await deleteRoute(ownerId, id)
  if (!deleted) {
    return jsonError('Route not found', 404)
  }

  return Response.json({ success: true }, { status: 200 })
}

export const Route = createFileRoute('/api/v1/health/routes')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
      DELETE: async ({ request }) => handleDelete(request),
    },
  },
})
