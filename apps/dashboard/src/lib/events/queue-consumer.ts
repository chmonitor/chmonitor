/**
 * Inbound event consumer: parse → normalize → dedup-upsert → optional re-emit.
 * One shared pipeline used by BOTH the ingest route's self-host inline path
 * (no Queue binding) and the Cloudflare Queue consumer once
 * `[[queues.consumers]]` is wired in wrangler.toml (see the external-setup
 * note there and plans/36-inbound-event-bus-queues.md). Never throws — a
 * malformed message degrades to a `failed` count rather than crashing the
 * batch/request.
 */

import type { NormalizedEvent } from './types'

import { upsertEvent } from './event-store'
import { expandEventBatch, normalizeEvent } from './normalize'
import { reemitEvent } from './reemit'
import { error } from '@chm/logger'

export interface ProcessPayloadResult {
  event: NormalizedEvent
  /**
   * Whether {@link upsertEvent} actually wrote the row to D1. `false` on
   * self-host (no CHM_CLOUD_D1 binding) or a transient D1 error — the event
   * was still normalized (and re-emit, if configured, still ran), so this is
   * reported honestly rather than assumed true. See "Honest claims" in
   * plans/36-inbound-event-bus-queues.md.
   */
  persisted: boolean
}

/**
 * Normalize + persist + (optionally) re-emit a single raw event payload.
 * Returns null only on a genuinely unexpected internal error — parsing a
 * malformed payload is NOT a failure here (normalizeEvent always degrades to
 * the generic shape rather than throwing), and neither is a D1 write miss
 * ({@link upsertEvent} already degrades to a no-op `false` return, surfaced
 * via `persisted`).
 */
export async function processEventPayload(
  payload: unknown,
  receivedAt: number = Date.now()
): Promise<ProcessPayloadResult | null> {
  try {
    const event = await normalizeEvent(payload, receivedAt)
    const persisted = await upsertEvent(event)
    await reemitEvent(event)
    return { event, persisted }
  } catch (err) {
    error(
      '[events/queue-consumer] Failed to process event payload',
      err as Error
    )
    return null
  }
}

export interface ProcessBatchResult {
  processed: number
  failed: number
}

/**
 * Cloudflare Queue consumer entrypoint (`queue(batch, env, ctx)` handler
 * body). NOT yet wired to a live `[[queues.consumers]]` binding — see the
 * wrangler.toml external-setup note — but implemented and unit-tested now so
 * wiring it later is a mechanical change (one binding + one worker-entry
 * `queue` export), not new logic.
 *
 * `processPayload` is injectable (defaults to {@link processEventPayload}) so
 * tests can simulate a processing failure and assert the retry() branch
 * without needing `processEventPayload` itself to fail (by design it almost
 * never does — normalize/store/reemit all degrade internally rather than
 * throw).
 */
export async function processEventBatch(
  batch: MessageBatch<unknown>,
  deps: { processPayload?: typeof processEventPayload } = {}
): Promise<ProcessBatchResult> {
  const processPayload = deps.processPayload ?? processEventPayload
  let processed = 0
  let failed = 0

  for (const message of batch.messages) {
    // A single queued message may carry a batch (top-level array or
    // `{ events: [...] }`) — expand it so each event is stored independently,
    // mirroring the ingest route's inline path.
    const items = expandEventBatch(message.body)
    let anyFailed = false
    for (const item of items) {
      const result = await processPayload(item)
      if (result) processed += 1
      else {
        failed += 1
        anyFailed = true
      }
    }
    // Ack the message only when every event in it succeeded; otherwise retry
    // the whole message (at-least-once — a repeat re-hits the same dedup rows).
    if (anyFailed) message.retry()
    else message.ack()
  }

  return { processed, failed }
}
