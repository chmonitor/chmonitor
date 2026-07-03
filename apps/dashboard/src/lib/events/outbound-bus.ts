/**
 * Outbound webhook event bus (plan 44).
 *
 * `emitEvent` fans a single event out to every enabled subscription a user
 * owns for that event type: HMAC-signed, retried with bounded backoff, and
 * recorded (delivered/failed/dead) in the `webhook_deliveries` audit log.
 *
 * SECURITY (SSRF): every subscription URL is re-validated at SEND time via
 * `validateHostUrl` — the SAME guard `routes/api/v1/health/webhook.ts` uses
 * for the existing alert-webhook proxy — before any fetch is attempted. This
 * is NOT `createHostValidationFetch`: that helper THROWS on Cloudflare
 * Workers for any non-IP-literal hostname (`WORKER_DNS_PINNING_ERROR`), which
 * would make delivery to an ordinary hostname (e.g. `hooks.slack.com`) fail
 * in production. `validateHostUrl` + a plain guarded `fetch` is the pattern
 * `health/webhook.ts` actually ships with, so that's what this mirrors.
 *
 * NON-BLOCKING: this app has no `ExecutionContext.waitUntil` plumbed through
 * to route handlers (see `src/start.ts`'s Sentry middleware comment — the
 * same constraint). Producers MUST call `emitEvent` WITHOUT awaiting it
 * (fire-and-forget: `void emitEvent(...)`) so a 0/2s/8s retry sequence never
 * slows the emitting request. `emitEvent` never throws, so an un-awaited call
 * can't produce an unhandled rejection either. On Cloudflare Workers this
 * makes delivery best-effort (the isolate may recycle before a slow retry
 * finishes) — an accepted tradeoff for a webhook feature, same one already
 * made for Sentry flushing in `start.ts`. On Node/Docker/Bun it runs to
 * completion since the process stays alive.
 */

import type { ResolveHostAddresses } from '@/lib/browser-connections/host-url'
import type { EventPayload, WebhookEventType } from './event-types'
import type {
  WebhookDeliveryRecord,
  WebhookSubscription,
} from './subscription-store'

import {
  listEnabledSubscriptionsForEvent,
  recordDelivery as recordDeliveryToStore,
} from './subscription-store'
import { error } from '@chm/logger'
import { validateHostUrl } from '@/lib/browser-connections/host-url'

/** Bounded retry: exactly 3 attempts total, waiting this long BEFORE each. */
const BACKOFF_DELAYS_MS = [0, 2000, 8000] as const
const MAX_ATTEMPTS = BACKOFF_DELAYS_MS.length
const DELIVERY_TIMEOUT_MS = 10_000

/** Generic, non-leaky message for a blocked/invalid destination URL (matches `health/webhook.ts`). */
const BLOCKED_URL_MESSAGE =
  'The webhook URL is not allowed. Use a public HTTPS endpoint.'

/** Injectable dependencies — tests override the resolver, fetch, backoff clock, and store calls. */
export interface DeliverDeps {
  resolveHostAddresses?: ResolveHostAddresses
  fetchImpl?: typeof fetch
  /** Awaited before each attempt; defaults to a real `setTimeout`. Inject a no-op in tests. */
  delay?: (ms: number) => Promise<void>
  recordDelivery?: (record: Omit<WebhookDeliveryRecord, 'id'>) => Promise<void>
}

export interface EmitEventDeps extends DeliverDeps {
  listSubscriptionsForEvent?: (
    userId: string,
    eventType: string
  ) => Promise<WebhookSubscription[]>
}

async function defaultDelay(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * HMAC-SHA256 over the exact raw body, hex-encoded. Signing target is the
 * body ONLY (not timestamp+body) — receivers verify with
 * `hex(hmac_sha256(secret, rawBody)) === signature`, matching the
 * `X-Chmonitor-Signature: sha256=<hex>` header this bus sends.
 */
export async function signPayload(
  secret: string,
  body: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(body)
  )
  return toHex(signature)
}

function eventTimeMs(evt: EventPayload): number {
  const parsed = Date.parse(evt.occurred_at)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

/** Summary of one `deliver()` call — returned so the "send test" action can report it immediately. */
export interface DeliveryOutcome {
  status: WebhookDeliveryRecord['status']
  attempts: number
  lastStatusCode: number | null
  lastError: string | null
}

const UNEXPECTED_FAILURE_OUTCOME: DeliveryOutcome = {
  status: 'dead',
  attempts: 0,
  lastStatusCode: null,
  lastError: 'Delivery failed unexpectedly (see server logs).',
}

/**
 * Deliver one event to one subscription: SSRF-guard, sign, POST with bounded
 * retry/backoff, then record the final outcome. Never throws — callers
 * (`emitEvent`) rely on that so one bad subscriber can't break the fan-out or
 * the producer.
 */
export async function deliver(
  sub: WebhookSubscription,
  evt: EventPayload,
  deps: DeliverDeps = {}
): Promise<DeliveryOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const delay = deps.delay ?? defaultDelay
  const recordDelivery = deps.recordDelivery ?? recordDeliveryToStore
  const occurredAt = eventTimeMs(evt)

  try {
    // SSRF guard — reject before any network call. A blocked host is a
    // deterministic failure (retrying changes nothing), so this is
    // dead-lettered immediately with zero HTTP attempts made.
    const ssrfError = await validateHostUrl(sub.url, deps.resolveHostAddresses)
    if (ssrfError) {
      error(
        '[events] Blocked SSRF-unsafe webhook subscription URL',
        new Error(ssrfError)
      )
      const outcome: DeliveryOutcome = {
        status: 'dead',
        attempts: 0,
        lastStatusCode: null,
        lastError: BLOCKED_URL_MESSAGE,
      }
      await recordDelivery({
        subscriptionId: sub.id,
        eventType: evt.type,
        eventTime: occurredAt,
        deliveredAt: null,
        ...outcome,
      })
      return outcome
    }

    const body = JSON.stringify(evt)
    const signature = await signPayload(sub.secret, body)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Chmonitor-Event': evt.type,
      'X-Chmonitor-Delivery': evt.id,
      'X-Chmonitor-Timestamp': String(Date.now()),
      'X-Chmonitor-Signature': `sha256=${signature}`,
    }

    let lastStatusCode: number | null = null
    let lastError: string | null = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await delay(BACKOFF_DELAYS_MS[attempt - 1])

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)
      try {
        const res = await fetchImpl(sub.url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        })
        lastStatusCode = res.status

        if (res.ok) {
          const outcome: DeliveryOutcome = {
            status: 'delivered',
            attempts: attempt,
            lastStatusCode: res.status,
            lastError: null,
          }
          await recordDelivery({
            subscriptionId: sub.id,
            eventType: evt.type,
            eventTime: occurredAt,
            deliveredAt: Date.now(),
            ...outcome,
          })
          return outcome
        }

        if (!isRetryableStatus(res.status)) {
          // Non-retryable 4xx (anything but 429): the caller's problem, not
          // a transient one — stop now instead of burning bounded retries.
          const outcome: DeliveryOutcome = {
            status: 'dead',
            attempts: attempt,
            lastStatusCode: res.status,
            lastError: `Non-retryable response status ${res.status}`,
          }
          await recordDelivery({
            subscriptionId: sub.id,
            eventType: evt.type,
            eventTime: occurredAt,
            deliveredAt: null,
            ...outcome,
          })
          return outcome
        }

        lastError = `Response status ${res.status}`
      } catch (fetchErr) {
        lastError =
          fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      } finally {
        clearTimeout(timeout)
      }
    }

    // Retries exhausted (network errors and/or 5xx/429 on every attempt).
    const outcome: DeliveryOutcome = {
      status: 'dead',
      attempts: MAX_ATTEMPTS,
      lastStatusCode,
      lastError,
    }
    await recordDelivery({
      subscriptionId: sub.id,
      eventType: evt.type,
      eventTime: occurredAt,
      deliveredAt: null,
      ...outcome,
    })
    return outcome
  } catch (err) {
    // Defense in depth: a store failure (e.g. D1 write error) while recording
    // the outcome must not propagate — deliver() is documented as never
    // throwing so Promise.allSettled in emitEvent never sees a rejection.
    error(
      '[events] deliver() failed unexpectedly',
      err instanceof Error ? err : new Error(String(err))
    )
    return UNEXPECTED_FAILURE_OUTCOME
  }
}

/**
 * Emit `evt` to every enabled subscription `userId` owns for `evt.type`.
 * Fire-and-forget from the producer's perspective — see the module docblock.
 * NEVER throws.
 */
export async function emitEvent(
  userId: string,
  evt: EventPayload,
  deps: EmitEventDeps = {}
): Promise<void> {
  try {
    const listSubscriptionsForEvent =
      deps.listSubscriptionsForEvent ?? listEnabledSubscriptionsForEvent
    const subs = await listSubscriptionsForEvent(userId, evt.type)
    if (subs.length === 0) return

    const results = await Promise.allSettled(
      subs.map((sub) => deliver(sub, evt, deps))
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        error(
          '[events] emitEvent: a delivery rejected unexpectedly',
          result.reason
        )
      }
    }
  } catch (err) {
    error(
      '[events] emitEvent failed',
      err instanceof Error ? err : new Error(String(err))
    )
  }
}

export type { EventPayload, WebhookEventType }
