/**
 * D1-backed store for outbound webhook subscriptions + delivery records
 * (plan 44). Mirrors `lib/connection-store/d1-store.ts`'s conventions: same
 * `CHM_CLOUD_D1` binding, same `crypto.randomUUID()` ids, same
 * `WHERE user_id = ? AND id = ?`-guarded mutations so one user can never read,
 * edit, or delete another user's subscription (the IDOR class plan 04 fixed
 * for conversations — see `D1_UPDATE_SUBSCRIPTION_SQL` / `D1_DELETE_SUBSCRIPTION_SQL`,
 * proven against real SQLite in `subscription-store.sql.test.ts`).
 */

import type { EmittableEventType } from './event-types'

import { isEmittableEventType } from './event-types'
import { getPlatformBindings } from '@chm/platform'

const D1_BINDING_NAME = 'CHM_CLOUD_D1'

export interface WebhookSubscription {
  id: string
  userId: string
  url: string
  secret: string
  eventTypes: EmittableEventType[]
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface CreateWebhookSubscriptionInput {
  url: string
  eventTypes: EmittableEventType[]
}

export interface UpdateWebhookSubscriptionInput {
  url?: string
  eventTypes?: EmittableEventType[]
  enabled?: boolean
}

export type WebhookDeliveryStatus = 'delivered' | 'failed' | 'dead'

export interface WebhookDeliveryRecord {
  id: string
  subscriptionId: string
  eventType: string
  status: WebhookDeliveryStatus
  attempts: number
  lastStatusCode: number | null
  lastError: string | null
  /** Epoch ms the source event occurred. */
  eventTime: number
  /** Epoch ms the delivery sequence finished; null while never-succeeded. */
  deliveredAt: number | null
}

export class WebhookSubscriptionStoreError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'NOT_CONFIGURED' | 'STORAGE_ERROR',
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'WebhookSubscriptionStoreError'
  }
}

interface D1SubscriptionRow {
  id: string
  user_id: string
  url: string
  secret: string
  event_types: string
  enabled: number
  created_at: number
  updated_at: number
}

interface D1DeliveryRow {
  id: string
  subscription_id: string
  event_type: string
  status: string
  attempts: number
  last_status_code: number | null
  last_error: string | null
  event_time: number
  delivered_at: number | null
}

function getDb(): D1Database {
  const db = getPlatformBindings().getD1Database(D1_BINDING_NAME)
  if (!db) {
    throw new WebhookSubscriptionStoreError(
      `${D1_BINDING_NAME} binding not found. Ensure D1 database is configured in wrangler.toml`,
      'NOT_CONFIGURED'
    )
  }
  return db
}

/** 32 random bytes, hex-encoded (64 chars) — a per-subscription HMAC key. */
export function generateSubscriptionSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function rowToSubscription(row: D1SubscriptionRow): WebhookSubscription {
  let eventTypes: EmittableEventType[]
  try {
    const parsed = JSON.parse(row.event_types) as unknown
    eventTypes = Array.isArray(parsed)
      ? parsed.filter(
          (v): v is EmittableEventType =>
            typeof v === 'string' && isEmittableEventType(v)
        )
      : []
  } catch {
    eventTypes = []
  }

  return {
    id: row.id,
    userId: row.user_id,
    url: row.url,
    secret: row.secret,
    eventTypes,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToDelivery(row: D1DeliveryRow): WebhookDeliveryRecord {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    eventType: row.event_type,
    status: row.status as WebhookDeliveryStatus,
    attempts: row.attempts,
    lastStatusCode: row.last_status_code,
    lastError: row.last_error,
    eventTime: row.event_time,
    deliveredAt: row.delivered_at,
  }
}

/** List every subscription owned by `userId`. */
export async function listSubscriptions(
  userId: string
): Promise<WebhookSubscription[]> {
  try {
    const db = getDb()
    const result = await db
      .prepare(
        `SELECT id, user_id, url, secret, event_types, enabled, created_at, updated_at
         FROM webhook_subscriptions WHERE user_id = ?1 ORDER BY created_at DESC`
      )
      .bind(userId)
      .all<D1SubscriptionRow>()
    return (result.results || []).map(rowToSubscription)
  } catch (error) {
    if (error instanceof WebhookSubscriptionStoreError) throw error
    throw new WebhookSubscriptionStoreError(
      `Failed to list webhook subscriptions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'STORAGE_ERROR',
      error
    )
  }
}

/** Owner-scoped read: `null` for a missing OR foreign-owned id — never distinguishes the two. */
export async function getSubscription(
  userId: string,
  id: string
): Promise<WebhookSubscription | null> {
  try {
    const db = getDb()
    const row = await db
      .prepare(
        `SELECT id, user_id, url, secret, event_types, enabled, created_at, updated_at
         FROM webhook_subscriptions WHERE user_id = ?1 AND id = ?2`
      )
      .bind(userId, id)
      .first<D1SubscriptionRow>()
    return row ? rowToSubscription(row) : null
  } catch (error) {
    if (error instanceof WebhookSubscriptionStoreError) throw error
    throw new WebhookSubscriptionStoreError(
      `Failed to read webhook subscription: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'STORAGE_ERROR',
      error
    )
  }
}

/**
 * Enabled subscriptions owned by `userId` whose `event_types` include
 * `eventType` — the bus's read path. Filtered in JS (per-user row counts are
 * small; a JSON column can't be indexed/queried directly in SQLite/D1).
 */
export async function listEnabledSubscriptionsForEvent(
  userId: string,
  eventType: string
): Promise<WebhookSubscription[]> {
  const all = await listSubscriptions(userId)
  return all.filter(
    (s) => s.enabled && (s.eventTypes as readonly string[]).includes(eventType)
  )
}

export async function createSubscription(
  userId: string,
  input: CreateWebhookSubscriptionInput
): Promise<WebhookSubscription> {
  const db = getDb()
  const now = Date.now()
  const id = crypto.randomUUID()
  const secret = generateSubscriptionSecret()

  try {
    await db
      .prepare(
        `INSERT INTO webhook_subscriptions
           (id, user_id, url, secret, event_types, enabled, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)`
      )
      .bind(
        id,
        userId,
        input.url,
        secret,
        JSON.stringify(input.eventTypes),
        now
      )
      .run()
  } catch (error) {
    throw new WebhookSubscriptionStoreError(
      `Failed to create webhook subscription: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'STORAGE_ERROR',
      error
    )
  }

  return {
    id,
    userId,
    url: input.url,
    secret,
    eventTypes: input.eventTypes,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Ownership-guarded UPDATE. Exported so `subscription-store.sql.test.ts` can
 * run this EXACT string against `bun:sqlite` and prove a foreign `user_id`
 * affects zero rows (mirrors `d1-store.ts`'s `D1_UPSERT_CONVERSATION_SQL`
 * pattern for plan 04's IDOR fix).
 */
export const D1_UPDATE_SUBSCRIPTION_SQL = `UPDATE webhook_subscriptions
   SET url = ?1, secret = ?2, event_types = ?3, enabled = ?4, updated_at = ?5
   WHERE id = ?6 AND user_id = ?7`

export async function updateSubscription(
  userId: string,
  id: string,
  patch: UpdateWebhookSubscriptionInput
): Promise<WebhookSubscription> {
  const existing = await getSubscription(userId, id)
  if (!existing) {
    throw new WebhookSubscriptionStoreError(
      'Webhook subscription not found',
      'NOT_FOUND'
    )
  }

  const db = getDb()
  const now = Date.now()
  const next: WebhookSubscription = {
    ...existing,
    url: patch.url ?? existing.url,
    eventTypes: patch.eventTypes ?? existing.eventTypes,
    enabled: patch.enabled ?? existing.enabled,
    updatedAt: now,
  }

  let changes: number
  try {
    const result = await db
      .prepare(D1_UPDATE_SUBSCRIPTION_SQL)
      .bind(
        next.url,
        next.secret,
        JSON.stringify(next.eventTypes),
        next.enabled ? 1 : 0,
        now,
        id,
        userId
      )
      .run()
    changes = result.meta.changes ?? 0
  } catch (error) {
    throw new WebhookSubscriptionStoreError(
      `Failed to update webhook subscription: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'STORAGE_ERROR',
      error
    )
  }

  if (changes === 0) {
    throw new WebhookSubscriptionStoreError(
      'Webhook subscription not found',
      'NOT_FOUND'
    )
  }

  return next
}

/**
 * Ownership-guarded DELETE. Exported for the same reason as
 * {@link D1_UPDATE_SUBSCRIPTION_SQL}.
 */
export const D1_DELETE_SUBSCRIPTION_SQL = `DELETE FROM webhook_subscriptions WHERE id = ?1 AND user_id = ?2`

export async function deleteSubscription(
  userId: string,
  id: string
): Promise<void> {
  const db = getDb()
  let changes: number
  try {
    const result = await db
      .prepare(D1_DELETE_SUBSCRIPTION_SQL)
      .bind(id, userId)
      .run()
    changes = result.meta.changes ?? 0
  } catch (error) {
    throw new WebhookSubscriptionStoreError(
      `Failed to delete webhook subscription: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'STORAGE_ERROR',
      error
    )
  }

  if (changes === 0) {
    throw new WebhookSubscriptionStoreError(
      'Webhook subscription not found',
      'NOT_FOUND'
    )
  }
}

/** Records one delivery-sequence outcome (dead-letter + audit log). */
export async function recordDelivery(
  record: Omit<WebhookDeliveryRecord, 'id'>
): Promise<void> {
  try {
    const db = getDb()
    await db
      .prepare(
        `INSERT INTO webhook_deliveries
           (id, subscription_id, event_type, status, attempts, last_status_code, last_error, event_time, delivered_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      )
      .bind(
        crypto.randomUUID(),
        record.subscriptionId,
        record.eventType,
        record.status,
        record.attempts,
        record.lastStatusCode,
        record.lastError,
        record.eventTime,
        record.deliveredAt
      )
      .run()
  } catch (error) {
    if (error instanceof WebhookSubscriptionStoreError) throw error
    throw new WebhookSubscriptionStoreError(
      `Failed to record webhook delivery: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'STORAGE_ERROR',
      error
    )
  }
}

/** Most recent deliveries for one subscription — callers must verify ownership first (see `getSubscription`). */
export async function listDeliveries(
  subscriptionId: string,
  limit = 20
): Promise<WebhookDeliveryRecord[]> {
  try {
    const db = getDb()
    const result = await db
      .prepare(
        `SELECT id, subscription_id, event_type, status, attempts, last_status_code, last_error, event_time, delivered_at
         FROM webhook_deliveries WHERE subscription_id = ?1 ORDER BY event_time DESC LIMIT ?2`
      )
      .bind(subscriptionId, limit)
      .all<D1DeliveryRow>()
    return (result.results || []).map(rowToDelivery)
  } catch (error) {
    if (error instanceof WebhookSubscriptionStoreError) throw error
    throw new WebhookSubscriptionStoreError(
      `Failed to list webhook deliveries: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'STORAGE_ERROR',
      error
    )
  }
}
