/**
 * POST /api/v1/slack/events — Slack Events API subscription endpoint.
 *
 * Verifies the Slack signature over the RAW body, then handles:
 *   - `url_verification` — echo the one-time `challenge` (used when you set the
 *     Events request URL in the Slack app config).
 *   - `app_home_opened` — publish the chmonitor Home tab (per-host health
 *     summary + how to use the slash commands + a dashboard link) for the
 *     opening user, using the workspace's stored bot token.
 *
 * Publishing happens INLINE before the 200 (this app has no waitUntil): the
 * Home view is built from a light, bounded set of parallel reads so it stays
 * within Slack's ack budget, and `views.publish` is idempotent so a Slack retry
 * simply republishes.
 *
 * Auth: the Slack signature IS the auth; never requires Clerk.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { getClickHouseConfigs } from '@chm/clickhouse-client'
import { error as logError } from '@chm/logger'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { queryAlertEvents } from '@/lib/health/alert-history-store'
import { captureIncidentSnapshot } from '@/lib/health/incident-snapshot'
import { publishHomeView } from '@/lib/slack/api'
import { buildHomeTabView, type HomeHostSummary } from '@/lib/slack/blocks'
import { readAndVerifySlackRequest } from '@/lib/slack/inbound'
import { getInstallation } from '@/lib/slack/install-store'

/** Cap how many hosts the Home tab summarizes so it stays within the ack budget. */
const HOME_HOST_CAP = 5

interface SlackEventEnvelope {
  type?: string
  challenge?: string
  team_id?: string
  event?: { type?: string; user?: string }
}

const OK = new Response(null, { status: 200 })

async function buildHomeSummaries(): Promise<HomeHostSummary[]> {
  bridgeClickHouseEnv(env as Record<string, string | undefined>)

  let configs: ReturnType<typeof getClickHouseConfigs>
  try {
    configs = getClickHouseConfigs().slice(0, HOME_HOST_CAP)
  } catch {
    return []
  }
  if (configs.length === 0) return []

  // Recent firing counts per host (fast D1 read; [] when no D1).
  const events = await queryAlertEvents({ limit: 100 })
  const firingByHost = new Map<number, number>()
  for (const e of events) {
    if (e.severity === 'recovery') continue
    firingByHost.set(e.hostId, (firingByHost.get(e.hostId) ?? 0) + 1)
  }

  // Memory/disk snapshots in parallel (~1 CH round-trip total).
  const snapshots = await Promise.all(
    configs.map((c) => captureIncidentSnapshot(c.id).catch(() => null))
  )

  return configs.map((c, i) => ({
    hostId: c.id,
    label: c.customName?.trim() || c.host,
    memoryUsagePct: snapshots[i]?.memoryUsagePct ?? null,
    diskUsagePct: snapshots[i]?.diskUsagePct ?? null,
    firing: firingByHost.get(c.id) ?? 0,
  }))
}

async function handleAppHomeOpened(
  teamId: string | undefined,
  userId: string | undefined,
  request: Request
): Promise<void> {
  if (!teamId || !userId) return
  const install = await getInstallation(teamId)
  if (!install) return // workspace not installed / token unusable

  const summaries = await buildHomeSummaries()
  const view = buildHomeTabView(summaries, {
    dashboardUrl: new URL(request.url).origin,
  })
  await publishHomeView({ botToken: install.botToken, userId, view })
}

async function handlePost(request: Request): Promise<Response> {
  const { configured, verified, rawBody } =
    await readAndVerifySlackRequest(request)
  if (!configured) {
    return Response.json({ error: 'Slack app not configured' }, { status: 501 })
  }
  if (!verified) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let envelope: SlackEventEnvelope
  try {
    envelope = JSON.parse(rawBody) as SlackEventEnvelope
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  // URL verification handshake.
  if (envelope.type === 'url_verification') {
    return new Response(envelope.challenge ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  if (
    envelope.type === 'event_callback' &&
    envelope.event?.type === 'app_home_opened'
  ) {
    try {
      await handleAppHomeOpened(envelope.team_id, envelope.event.user, request)
    } catch (err) {
      // Never fail the event ack over a Home-tab publish error — Slack would
      // just retry; log and 200 so it stops.
      logError('[slack-events] app_home_opened publish failed', err)
    }
  }

  return OK
}

export const Route = createFileRoute('/api/v1/slack/events')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handlePost as __handlePostForTests }
