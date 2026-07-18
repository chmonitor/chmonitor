/**
 * Unified alert channel config CRUD (feat #2665)
 *
 *   GET    /api/v1/health/alert-config              — list the caller's channel configs (masked)
 *   PUT    /api/v1/health/alert-config               — upsert ONE channel's config
 *   DELETE /api/v1/health/alert-config?channel=<id>  — delete one channel's config (revert to env)
 *
 * Makes the env-only server channels (opsgenie/email/twilio/…) editable from
 * the Health Settings UI and — via the cron sweep's `resolveServerChannels` —
 * visible to autonomous alerting. Owner-scoped via
 * {@link resolveAlertRoutingOwnerId} (shared with `routes.ts`): self-hosted
 * manages configs with zero auth under the OSS single-tenant owner `''`, cloud
 * requires sign-in for writes. The store (`alert-channel-config-store.ts`) is
 * best-effort D1 — GET always returns 200 with a (possibly empty) list.
 *
 * Secrets are WRITE-ONLY: each channel has at most one secret (api key / bot
 * token / auth token / email provider url) that is masked on read (last 4 chars)
 * and, on update, an empty secret KEEPS the stored one — same posture as the
 * PagerDuty routing key in `routes.ts`.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { AlertConfigChannel } from '@/lib/health/alert-channel-config-store'

import { validateHostUrl } from '@/lib/browser-connections/host-url'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import {
  deleteChannelConfig,
  isAlertConfigChannel,
  listChannelConfigs,
  upsertChannelConfig,
} from '@/lib/health/alert-channel-config-store'
import {
  requiresSignInForWrite,
  resolveAlertRoutingOwnerId,
} from '@/lib/health/alert-routing-auth'
import {
  getServerEmailConfig,
  getServerHealthchecksUrl,
  getServerNtfyConfig,
  getServerOpsgenieConfig,
  getServerPushoverConfig,
  getServerTelegramConfig,
  getServerTwilioConfig,
} from '@/lib/health/server-alert-config'

/** Channels whose `target.url` is a caller-supplied outbound URL → SSRF sink. */
const URL_TARGET_CHANNELS: ReadonlySet<AlertConfigChannel> = new Set([
  'webhook',
  'healthchecks',
  'ntfy',
])

function jsonError(message: string, status: number): Response {
  return Response.json({ success: false, error: { message } }, { status })
}

/** Mask a bare secret — shows only the last 4 chars, like `routes.ts`. */
function maskSecret(secret: string): string {
  if (secret.length <= 4) return '••••'
  return `••••${secret.slice(-4)}`
}

function toPublicChannelConfig(
  config: Awaited<ReturnType<typeof listChannelConfigs>>[number]
) {
  return {
    channel: config.channel,
    enabled: config.enabled,
    minSeverity: config.minSeverity,
    // Non-secret destination fields, returned as-is so the UI can render them.
    target: config.target,
    // The secret is never returned in full once stored — only whether one
    // exists, plus a last-4 mask so the UI can show "•••• set".
    hasSecret: Boolean(config.secret),
    secretMasked: config.secret ? maskSecret(config.secret) : null,
    updatedAt: config.updatedAt,
  }
}

/**
 * Which channels are configured via server env (no secrets — booleans only), so
 * the UI can show "configured via server env" for a channel that has no D1 row
 * but an env fallback. Never leaks a secret.
 */
function envConfiguredMap(): Record<AlertConfigChannel, boolean> {
  return {
    webhook: Boolean(process.env.HEALTH_ALERT_WEBHOOK_URL?.trim()),
    healthchecks: Boolean(getServerHealthchecksUrl()),
    email: getServerEmailConfig() !== null,
    opsgenie: getServerOpsgenieConfig() !== null,
    telegram: getServerTelegramConfig() !== null,
    ntfy: getServerNtfyConfig() !== null,
    pushover: getServerPushoverConfig() !== null,
    twilio: getServerTwilioConfig() !== null,
  }
}

async function handleGet(): Promise<Response> {
  const ownerId = await resolveAlertRoutingOwnerId()
  const configs = await listChannelConfigs(ownerId)
  return Response.json(
    {
      success: true,
      configs: configs.map(toPublicChannelConfig),
      env: envConfiguredMap(),
    },
    { status: 200 }
  )
}

interface UpsertBody {
  channel?: unknown
  enabled?: unknown
  minSeverity?: unknown
  target?: unknown
  secret?: unknown
}

/** Coerce an untrusted `target` into a flat string map. */
function parseTarget(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

async function handlePut(request: Request): Promise<Response> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  const ownerId = await resolveAlertRoutingOwnerId()
  if (requiresSignInForWrite(ownerId)) {
    return jsonError('Sign in to edit alert channels.', 401)
  }

  let body: UpsertBody
  try {
    body = (await request.json()) as UpsertBody
  } catch {
    return jsonError('Request body must be valid JSON', 400)
  }

  if (!isAlertConfigChannel(body.channel)) {
    return jsonError('Missing or invalid "channel"', 400)
  }
  const channel = body.channel
  const enabled = body.enabled === true
  const minSeverity: 'warning' | 'critical' | null =
    body.minSeverity === 'warning' || body.minSeverity === 'critical'
      ? body.minSeverity
      : null
  const target = parseTarget(body.target)
  const secret = typeof body.secret === 'string' ? body.secret : ''

  // SSRF guard: for channels whose destination is a caller-supplied URL, run
  // the same guard the webhook/routes paths use before storing. Delivery
  // re-validates at send time; this just fails fast with a clear error.
  if (URL_TARGET_CHANNELS.has(channel)) {
    const url = target.url?.trim() || ''
    if (url) {
      if (!url.startsWith('https://')) {
        return jsonError('Channel URL must be an HTTPS endpoint', 400)
      }
      const ssrfError = await validateHostUrl(url)
      if (ssrfError) return jsonError(ssrfError, 400)
    }
  }

  const saved = await upsertChannelConfig({
    ownerId,
    channel,
    enabled,
    minSeverity,
    target,
    secret,
  })

  if (!saved) {
    return jsonError(
      'Alert channel storage is not configured (no D1 binding) or the write failed.',
      501
    )
  }

  return Response.json(
    { success: true, config: toPublicChannelConfig(saved) },
    { status: 200 }
  )
}

async function handleDelete(request: Request): Promise<Response> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  const ownerId = await resolveAlertRoutingOwnerId()
  if (requiresSignInForWrite(ownerId)) {
    return jsonError('Sign in to edit alert channels.', 401)
  }

  const { searchParams } = new URL(request.url)
  const channel = searchParams.get('channel')
  if (!isAlertConfigChannel(channel)) {
    return jsonError('Missing or invalid "channel" query param', 400)
  }

  const deleted = await deleteChannelConfig(ownerId, channel)
  if (!deleted) {
    return jsonError('Channel config not found', 404)
  }
  return Response.json({ success: true }, { status: 200 })
}

export const Route = createFileRoute('/api/v1/health/alert-config')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      PUT: async ({ request }) => handlePut(request),
      DELETE: async ({ request }) => handleDelete(request),
    },
  },
})

// Exported for unit tests only.
export {
  handleGet as __handleGetForTests,
  handlePut as __handlePutForTests,
  handleDelete as __handleDeleteForTests,
}
