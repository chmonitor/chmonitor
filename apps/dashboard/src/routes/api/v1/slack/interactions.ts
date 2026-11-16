/**
 * POST /api/v1/slack/interactions — Slack interactivity (Block Kit actions).
 *
 * Handles the "Acknowledge" button on pushed alert messages: verify the Slack
 * signature over the RAW body → decode the button `value` (the alert dedup key)
 * → write an ACK to the alert-ack store (actor = the Slack user) → edit the
 * original message via its `response_url` to show "Acknowledged by @user",
 * and react 👀 on it with the bot (the same alert state the sweep shows in
 * reactions; a token without `reactions:write` just skips it).
 *
 * The ACK feeds into the same `alert-ack-store` the health sweep reads (plan
 * 29's `isAcked`/`listActiveAcks`), so acking from Slack suppresses the sweep's
 * dispatch too — not just a cosmetic message edit. A Slack button click has no
 * duration picker, so it acks for the longest whitelisted window (240m); the
 * operator can always re-ack (via Slack or the Active Alerts panel) to extend.
 * Owner scope is the fixed OSS single-tenant id (`''`), matching the sweep's
 * own `SWEEP_ROUTING_OWNER_ID` convention — the sweep has no per-tenant
 * session to resolve against.
 *
 * SSRF: `response_url` comes from the (verified) Slack payload but is still
 * checked against a Slack-host allowlist AND the shared SSRF guard before we
 * POST to it (see lib/slack/api.ts).
 *
 * Auth: the Slack signature IS the auth; never requires Clerk.
 */

import { createFileRoute } from '@tanstack/react-router'

import { error as logError } from '@chm/logger'
import { ackAlert } from '@/lib/health/alert-ack-store'
import {
  ACK_REACTION,
  reactSlackBot,
} from '@/lib/health/sweep/dispatch/channels/slack-bot'
import { postToResponseUrl } from '@/lib/slack/api'
import {
  ACK_ACTION_ID,
  buildAckedMessageBlocks,
  decodeAckValue,
  type SlackBlock,
} from '@/lib/slack/blocks'
import { getSlackBotToken } from '@/lib/slack/config'
import { readAndVerifySlackRequest } from '@/lib/slack/inbound'
import { slackBotTokenSource } from '@/lib/slack/target'

interface SlackAction {
  action_id?: string
  value?: string
  type?: string
}

interface SlackInteractionPayload {
  type?: string
  user?: { id?: string; username?: string; name?: string }
  team?: { id?: string }
  channel?: { id?: string }
  container?: { message_ts?: string; channel_id?: string }
  response_url?: string
  message?: { ts?: string; blocks?: SlackBlock[] }
  actions?: SlackAction[]
}

/** 👀 on the clicked message, posted with the bot the alerts use. */
function reactToAck(payload: SlackInteractionPayload): Promise<void> {
  const teamId = payload.team?.id
  const channel = payload.container?.channel_id ?? payload.channel?.id
  const ts = payload.container?.message_ts ?? payload.message?.ts
  if (!teamId || !channel || !ts) return Promise.resolve()
  const token = slackBotTokenSource(teamId, {
    botToken: getSlackBotToken() !== undefined,
  })
  return reactSlackBot({ kind: 'bot', token, channel }, [
    { ts, add: ACK_REACTION, remove: [] },
  ])
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
  // user gets feedback — ackAlert only throws on a missing/misconfigured D1
  // binding, which we swallow here the same way the rest of this handler
  // degrades gracefully when Slack app config is partial).
  try {
    await ackAlert({
      ownerId: '',
      hostId: ackKey.hostId,
      ruleId: ackKey.ruleId,
      durationKey: '240m',
      ackedBy: userName ? `${userName} (${userId})` : userId,
      note: 'Acknowledged via Slack',
    })
  } catch (err) {
    logError(
      '[slack-interactions] failed to persist ACK',
      err instanceof Error ? err : new Error(String(err))
    )
  }

  // Edit the original message (drop the button, append an "acked by" line)
  // and react to it. Slack wants the 200 within 3 s and there is no
  // waitUntil, so both run at once.
  const originalBlocks = payload.message?.blocks ?? []
  const responseUrl = payload.response_url
  await Promise.all([
    responseUrl
      ? postToResponseUrl(responseUrl, {
          replace_original: true,
          blocks: buildAckedMessageBlocks(originalBlocks, userId, nowIso),
        })
      : undefined,
    reactToAck(payload),
  ])

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
