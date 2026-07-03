/**
 * Inbound Event Ingest — POST /api/events/ingest
 *
 * Accepts a vendor-shaped event payload (Alertmanager, Datadog, or generic
 * JSON) from an external alerting system and normalizes/dedups/stores it into
 * `event_log` (see lib/events/). Two delivery modes:
 *
 * - Cloud, Queue bound: `env.CHM_EVENTS_QUEUE.send(payload)` → 202 Accepted.
 *   The queue consumer (lib/events/queue-consumer.ts `processEventBatch`)
 *   normalizes/stores/re-emits asynchronously.
 * - Self-host / no Queue binding (the default everywhere today — wrangler.toml
 *   does not yet declare `[[queues.producers]]`; see its external-setup note):
 *   runs the SAME pipeline (`processEventPayload`) inline and returns 200.
 *
 * Fail-open invariant: a missing/erroring Queue binding NEVER throws or 500s
 * — it falls back to the inline path. See
 * plans/36-inbound-event-bus-queues.md ("self-hosted/OSS stays whole").
 *
 * Auth: a per-source shared token (CHM_EVENTS_INGEST_TOKEN), NOT Clerk — this
 * is a machine-to-machine webhook receiver (Alertmanager/Datadog config), not
 * a browser/user request. Fails CLOSED (503) when unconfigured, mirroring
 * CRON_SECRET in api/cron/retention-prune.ts: an open unauthenticated write
 * endpoint on the public worker is exactly the class of issue plan 05
 * (health-webhook-auth-gate) fixed for the outbound proxy — ingest must not
 * reopen it on the inbound side.
 */

import { createFileRoute } from '@tanstack/react-router'

import { error, log, warn } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'
import {
  checkRateLimit,
  clientIpKey,
  getApiRateLimitPerMin,
  rateLimitResponse,
} from '@/lib/api/rate-limiter'
import { secretsMatch } from '@/lib/auth/providers/constant-time'
import { processEventPayload } from '@/lib/events/queue-consumer'

/** Generous but bounded — an alert payload is never legitimately larger. */
const MAX_BODY_BYTES = 256 * 1024

/** Queue producer binding name — see wrangler.toml external-setup note. */
const EVENTS_QUEUE_BINDING = 'CHM_EVENTS_QUEUE'

/**
 * Authorize an ingest request against CHM_EVENTS_INGEST_TOKEN. Returns a
 * short-circuit Response when rejected, or null when authorized.
 *
 * Fail-closed: unset/empty token disables the endpoint (503) rather than
 * accepting unauthenticated writes.
 */
function authorizeIngest(request: Request): Response | null {
  const token = process.env.CHM_EVENTS_INGEST_TOKEN?.trim()
  if (!token) {
    warn(
      '[POST /api/events/ingest] CHM_EVENTS_INGEST_TOKEN not configured — refusing (503). Set CHM_EVENTS_INGEST_TOKEN to enable inbound event ingest.'
    )
    return Response.json(
      { error: 'Event ingest is not configured' },
      { status: 503 }
    )
  }

  const authHeader = request.headers.get('authorization') ?? ''
  const provided = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''

  if (provided && secretsMatch(provided, token)) return null
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}

/** Injectable deps for tests: override the queue lookup without a Worker. */
interface IngestDeps {
  getQueue?: () => Queue | null
}

async function handlePost(
  request: Request,
  deps: IngestDeps = {}
): Promise<Response> {
  const denied = authorizeIngest(request)
  if (denied) return denied

  const rl = checkRateLimit(
    `events-ingest:ip:${clientIpKey(request)}`,
    getApiRateLimitPerMin()
  )
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec)

  const rawBody = await request.text().catch(() => '')
  if (!rawBody) {
    return Response.json(
      { error: 'Request body must be non-empty JSON' },
      { status: 400 }
    )
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return Response.json({ error: 'Request body too large' }, { status: 413 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return Response.json(
      { error: 'Request body must be valid JSON' },
      { status: 400 }
    )
  }

  const resolveQueue =
    deps.getQueue ??
    (() => getPlatformBindings().getQueue(EVENTS_QUEUE_BINDING))

  let queue: Queue | null = null
  try {
    queue = resolveQueue()
  } catch {
    // Binding resolution failed (e.g. outside a Worker) — degrade to inline.
    queue = null
  }

  if (queue) {
    try {
      await queue.send(payload)
      return Response.json({ accepted: true, mode: 'queued' }, { status: 202 })
    } catch (err) {
      error(
        '[POST /api/events/ingest] Queue send failed — falling back to inline processing',
        err as Error
      )
      // Fall through to the inline path as a safety net rather than dropping
      // the event.
    }
  }

  const result = await processEventPayload(payload)
  if (!result) {
    // processEventPayload only returns null on a genuinely unexpected internal
    // error — normalize/store/reemit each already degrade internally rather
    // than throw. Still 200 so the sender doesn't retry-storm a payload
    // chmonitor already looked at.
    log('[POST /api/events/ingest] Inline processing returned no result')
    return Response.json(
      { accepted: true, mode: 'inline', persisted: false },
      { status: 200 }
    )
  }

  // `persisted` is honest, not assumed: false on self-host (no CHM_CLOUD_D1)
  // or a transient D1 error, even though the event was normalized (and
  // re-emitted, if configured).
  return Response.json(
    {
      accepted: true,
      mode: 'inline',
      persisted: result.persisted,
      id: result.event.id,
      dedupHash: result.event.dedupHash,
    },
    { status: 200 }
  )
}

export const Route = createFileRoute('/api/events/ingest')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handlePost as __handlePostForTests }
