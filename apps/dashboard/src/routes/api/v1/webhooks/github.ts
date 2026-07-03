/**
 * POST /api/v1/webhooks/github — GitHub deployment webhook receiver.
 *
 * Ingests `deployment` / `deployment_status` events (GitHub Settings →
 * Webhooks → Payload URL, events: "Deployments"), verifies the raw body
 * against `X-Hub-Signature-256` (see lib/deployments/verify-signature.ts),
 * parses the fields chmonitor needs (lib/deployments/parse-event.ts), and
 * upserts into D1 (lib/deployments/d1-store.ts) keyed by GitHub's
 * deployment.id so redeliveries update in place instead of duplicating.
 *
 * Unauthenticated by design — the signature IS the auth, mirroring the
 * verify-then-act shape of routes/api/v1/webhooks/polar.ts. Per
 * plans/45-github-deploy-correlation.md: a missing/mismatched signature is
 * rejected 401 (not 403 — this route's plan explicitly calls out 401,
 * unlike Polar's 403).
 *
 * Fails open: no `GITHUB_WEBHOOK_SECRET` configured (self-hosted/OSS
 * default) ⇒ 501, no deployments ingested, no behavior change. Other event
 * types (e.g. `deployment_review`) are acknowledged 204 without action.
 */
import { createFileRoute } from '@tanstack/react-router'

import { error as logError, log as logInfo } from '@chm/logger'
import {
  DEFAULT_DEPLOYMENT_SCOPE,
  getGithubWebhookSecret,
} from '@/lib/deployments/config'
import { upsertDeployment } from '@/lib/deployments/d1-store'
import { parseGithubDeploymentEvent } from '@/lib/deployments/parse-event'
import { verifyGithubSignature } from '@/lib/deployments/verify-signature'

const HANDLED_EVENTS = new Set(['deployment', 'deployment_status'])

/** Test-only export — mirrors the `__handlePostForTests` convention in
 * routes/api/v1/health/webhook.test.ts / polar.ts. */
export async function __handlePostForTests(
  request: Request
): Promise<Response> {
  return handlePost(request)
}

async function handlePost(request: Request): Promise<Response> {
  const secret = getGithubWebhookSecret()
  if (!secret) {
    return Response.json(
      { error: 'GitHub deploy webhook not configured' },
      { status: 501 }
    )
  }

  const rawBody = await request.text()
  const signatureHeader = request.headers.get('x-hub-signature-256')

  const verified = await verifyGithubSignature(secret, rawBody, signatureHeader)
  if (!verified) {
    logError('[github-deploy-webhook] rejected: missing/mismatched signature')
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const eventType = request.headers.get('x-github-event')
  if (!eventType || !HANDLED_EVENTS.has(eventType)) {
    // Acknowledge unhandled events (deployment_review, ping, etc.) without action.
    return new Response(null, { status: 204 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch (err) {
    logError('[github-deploy-webhook] failed to parse JSON body', err)
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  const parsed = parseGithubDeploymentEvent(body)
  if (!parsed) {
    return Response.json(
      { error: 'Missing required deployment fields' },
      { status: 400 }
    )
  }

  const ok = await upsertDeployment({
    id: parsed.id,
    ownerScope: DEFAULT_DEPLOYMENT_SCOPE,
    repo: parsed.repo,
    environment: parsed.environment,
    ref: parsed.ref,
    sha: parsed.sha,
    version: parsed.version,
    createdAt: parsed.createdAtMs,
    receivedAt: Date.now(),
  })

  if (!ok) {
    // Best-effort D1 write failed (missing binding, transient error) — still
    // acknowledge so GitHub doesn't retry forever over a non-critical,
    // observe-only write. Logged inside upsertDeployment.
    return Response.json({ received: true, stored: false }, { status: 202 })
  }

  logInfo('[github-deploy-webhook] stored deployment', {
    id: parsed.id,
    repo: parsed.repo,
    environment: parsed.environment,
  })

  return Response.json({ received: true, stored: true }, { status: 202 })
}

export const Route = createFileRoute('/api/v1/webhooks/github')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})
