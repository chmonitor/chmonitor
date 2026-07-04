/**
 * POST /api/v1/slack/interactions — Slack interactivity (Block Kit actions).
 *
 * Handles the "Acknowledge" button on pushed alert messages: verify the Slack
 * signature over the RAW body → decode the button `value` (the alert dedup key)
 * → write an ACK to the alert-ack store (actor = the Slack user) → edit the
 * original message via its `response_url` to show "Acknowledged by @user".
 *
 * The ACK write is intentionally minimal and does NOT feed back into the
 * sweep's in-memory dedup (`alert-state-store.ts`) — that coupling is roadmap
 * 29's job; adding it here would be inventing a parallel state store.
 *
 * SSRF: `response_url` comes from the (verified) Slack payload but is still
 * checked against a Slack-host allowlist AND the shared SSRF guard before we
 * POST to it (see lib/slack/api.ts).
 *
 * Auth: the Slack signature IS the auth; never requires Clerk.
 */

import { createFileRoute } from '@tanstack/react-router'

import { error as logError } from '@chm/logger'
import { recordAlertAck } from '@/lib/health/alert-ack-store'
import { postToResponseUrl } from '@/lib/slack/api'
import {
  ACK_ACTION_ID,
  buildAckedMessageBlocks,
  decodeAckValue,
  type SlackBlock,
} from '@/lib/slack/blocks'
import { readAndVerifySlackRequest } from '@/lib/slack/inbound'

interface SlackAction {
  action_id?: string
  value?: string
  type?: string
}

interface SlackInteractionPayload {
  type?: string
  user?: { id?: string; username?: string; name?: string }
  response_url?: string
  message?: { blocks?: SlackBlock[] }
  actions?: SlackAction[]
}

/** Empty 200 — acknowledges the interaction without posting a new message. */
const OK = new Response(null, { status: 200 })

async function handlePost(request: Request): Promise<Response> {
  const { configured, verified, rawBody } =
    await readAndVerifySlackRequest(request)
  if (!configured) {
    return Response.json({ error: 'Slack app not configured' }, { status: 501 })
  }
  if (!verified) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Interaction payloads arrive as a form field `payload` containing JSON.
  const encoded = new URLSearchParams(rawBody).get('payload')
  if (!encoded) return OK

  let payload: SlackInteractionPayload
  try {
    payload = JSON.parse(encoded) as SlackInteractionPayload
  } catch {
    return OK
  }

  if (payload.type !== 'block_actions') return OK

  const ackAction = payload.actions?.find((a) => a.action_id === ACK_ACTION_ID)
  if (!ackAction) return OK

  const ackKey = decodeAckValue(ackAction.value)
  if (!ackKey) {
    logError('[slack-interactions] ACK with malformed value')
    return OK
  }

  const userId = payload.user?.id ?? 'unknown'
  const userName = payload.user?.name ?? payload.user?.username ?? null
  const nowIso = new Date().toISOString()

  // Persist the ACK (best-effort; a failed write still edits the message so the
  // user gets feedback — the store logs its own failures).
  await recordAlertAck({
    ackKey: `${ackKey.hostId}:${ackKey.ruleId}:${ackKey.severity}`,
    hostId: ackKey.hostId,
    ruleId: ackKey.ruleId,
    severity: ackKey.severity,
    ackedBy: userId,
    ackedByName: userName,
    source: 'slack',
    ackedAt: Date.now(),
  })

  // Edit the original message: drop the button, append an "acked by" line.
  const originalBlocks = payload.message?.blocks ?? []
  if (payload.response_url) {
    await postToResponseUrl(payload.response_url, {
      replace_original: true,
      blocks: buildAckedMessageBlocks(originalBlocks, userId, nowIso),
    })
  }

  return OK
}

export const Route = createFileRoute('/api/v1/slack/interactions')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handlePost as __handlePostForTests }
