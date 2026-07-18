/**
 * Unified server-persisted alert channel config (feat #2665).
 *
 * The split brain this fixes: client channels (webhook / healthchecks) lived in
 * the browser's localStorage — invisible to the cron sweep — and server
 * channels (opsgenie / email / twilio / …) were env-only, uneditable from the
 * UI. This module is a per-owner, D1-backed store for EVERY delivery channel's
 * config, so the sweep and the UI read/write the same source of truth.
 *
 * Follows `alert-routing.ts` exactly:
 *   - Binding `CHM_CLOUD_D1` via {@link getPlatformBindings}; {@link getDb}
 *     returns `null` (never throws) when unconfigured.
 *   - ALL CRUD is best-effort and NEVER throws: a missing binding, an unmigrated
 *     table, or any D1 error resolves to `[]` / `null` / `false`. So a
 *     deployment with no D1 (the OSS default) degrades to "no rows", and
 *     `resolveServerChannels` falls back to the env readers — env behavior is
 *     byte-identical to before this store existed.
 *
 * Secret handling: each channel has at most ONE secret (api key / bot token /
 * auth token / email provider url). It is stored raw here and returned raw to
 * server-side callers (the sweep needs it to dispatch); the API route masks it
 * on the way out (`toPublicChannelConfig`) and this store's upsert keeps the
 * existing secret when the caller sends an empty one (write-only semantics),
 * exactly like the routes API's "empty string = keep existing".
 *
 * Browser notifications stay in localStorage (per-browser by nature) and are
 * NOT a channel here — only outbound, server-reachable channels are.
 */

import type { AlertSeverityFloor } from './alert-channel-settings'

import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const COMPONENT = 'alert-channel-config'
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[alert-channel-config] ${msg}`, {
    component: COMPONENT,
  })

const TABLE = 'alert_channel_config'

/**
 * Every outbound delivery channel that can be persisted here. Superset of
 * `AlertChannelId`'s server-reachable members plus `twilio` (which keeps its
 * own severity floor and is excluded from the generic `ChannelSettingsMap`).
 * `browser` / `pagerduty` are intentionally absent: browser notifications are
 * per-browser (localStorage), and PagerDuty is configured per-route in
 * `alert_routes`, not as a single global destination.
 */
export type AlertConfigChannel =
  | 'webhook'
  | 'healthchecks'
  | 'email'
  | 'opsgenie'
  | 'telegram'
  | 'ntfy'
  | 'pushover'
  | 'twilio'

/** Ordered channel list — the UI iterates this, parsing validates against it. */
export const ALERT_CONFIG_CHANNELS: readonly AlertConfigChannel[] = [
  'webhook',
  'healthchecks',
  'email',
  'opsgenie',
  'telegram',
  'ntfy',
  'pushover',
  'twilio',
]

export function isAlertConfigChannel(v: unknown): v is AlertConfigChannel {
  return (
    typeof v === 'string' &&
    (ALERT_CONFIG_CHANNELS as readonly string[]).includes(v)
  )
}

/**
 * One channel's persisted config. `target` holds the channel's non-secret
 * destination fields (see the per-channel field contracts in
 * `server-channel-resolve.ts`); `secret` is the single secret, raw. Returned to
 * SERVER-SIDE callers only — the API route masks `secret` before it leaves.
 */
export interface AlertChannelConfig {
  channel: AlertConfigChannel
  enabled: boolean
  /** `null` = inherit the channel/global gate (#2661). */
  minSeverity: AlertSeverityFloor | null
  /** Non-secret destination fields (urls, chat ids, regions, to/from, …). */
  target: Record<string, string>
  /** The channel's single secret (raw), or `null` when it has none / is unset. */
  secret: string | null
  updatedAt: number
}

interface D1ChannelConfigRow {
  owner_id: string
  channel: string
  enabled: number
  min_severity: string | null
  target_json: string | null
  secret: string | null
  updated_at: number
}

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

/** Parse the stored `target_json` into a flat string map, tolerating junk. */
function parseTarget(raw: string | null): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function rowToConfig(row: D1ChannelConfigRow): AlertChannelConfig {
  return {
    channel: row.channel as AlertConfigChannel,
    enabled: row.enabled === 1,
    minSeverity:
      row.min_severity === 'warning' || row.min_severity === 'critical'
        ? row.min_severity
        : null,
    target: parseTarget(row.target_json),
    secret: row.secret ?? null,
    updatedAt: row.updated_at,
  }
}

/** SELECT every channel config for an owner. Exported for the SQL round-trip test. */
export const D1_LIST_CHANNEL_CONFIG_SQL = `SELECT owner_id, channel, enabled, min_severity, target_json, secret, updated_at
   FROM ${TABLE}
   WHERE owner_id = ?1
   ORDER BY channel ASC`

/**
 * Upsert one channel's config, keyed by (owner_id, channel). The secret is
 * WRITE-ONLY: an empty / NULL `?6` keeps the existing stored secret (so the UI
 * can save non-secret edits without re-typing the secret), while a non-empty
 * value replaces it. Exported for the SQL round-trip test.
 */
export const D1_UPSERT_CHANNEL_CONFIG_SQL = `INSERT INTO ${TABLE}
     (owner_id, channel, enabled, min_severity, target_json, secret, updated_at)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
   ON CONFLICT(owner_id, channel) DO UPDATE SET
     enabled = excluded.enabled,
     min_severity = excluded.min_severity,
     target_json = excluded.target_json,
     secret = CASE
       WHEN excluded.secret IS NULL OR excluded.secret = ''
         THEN ${TABLE}.secret
         ELSE excluded.secret
     END,
     updated_at = excluded.updated_at`

/**
 * List every channel config for an owner, best-effort. Returns `[]` when D1
 * isn't configured (self-hosted/OSS default) or on any store error — NEVER
 * throws, so a config-table hiccup can never break the sweep or the settings UI.
 */
export async function listChannelConfigs(
  ownerId: string
): Promise<AlertChannelConfig[]> {
  try {
    const db = getDb()
    if (!db) return []
    const result = await db
      .prepare(D1_LIST_CHANNEL_CONFIG_SQL)
      .bind(ownerId)
      .all<D1ChannelConfigRow>()
    // The table also holds reserved sentinel rows (e.g. the digest settings'
    // '__digest__' key) that are NOT channel configs — without this filter they
    // would leak into the public GET /alert-config response and pollute the
    // sweep's mergeChannelSettings map with a bogus channel id.
    return (result.results ?? [])
      .filter((row) => isAlertConfigChannel(row.channel))
      .map(rowToConfig)
  } catch (err) {
    warn(`failed to list channel configs for owner ${ownerId}: ${err}`)
    return []
  }
}

/** Read one channel's config, best-effort. Returns `null` when absent or on error. */
export async function getChannelConfig(
  ownerId: string,
  channel: AlertConfigChannel
): Promise<AlertChannelConfig | null> {
  const all = await listChannelConfigs(ownerId)
  return all.find((c) => c.channel === channel) ?? null
}

export interface UpsertChannelConfigInput {
  ownerId: string
  channel: AlertConfigChannel
  enabled: boolean
  /** `null` / omitted = inherit the channel/global gate (#2661). */
  minSeverity?: AlertSeverityFloor | null
  /** Non-secret destination fields. Replaced wholesale on each upsert. */
  target: Record<string, string>
  /** Empty string / `null` / omitted = KEEP the existing stored secret. */
  secret?: string | null
}

/**
 * Create or update one channel's config, best-effort. Returns the resolved
 * {@link AlertChannelConfig} on success (re-read so callers see the effective
 * secret-keep result), or `null` on any store failure — never throws.
 */
export async function upsertChannelConfig(
  input: UpsertChannelConfigInput
): Promise<AlertChannelConfig | null> {
  try {
    const db = getDb()
    if (!db) return null

    const minSeverity: AlertSeverityFloor | null =
      input.minSeverity === 'warning' || input.minSeverity === 'critical'
        ? input.minSeverity
        : null
    // Only persist string target fields, and drop empties so `target_json`
    // never carries `{"url":""}` noise.
    const target: Record<string, string> = {}
    for (const [k, v] of Object.entries(input.target)) {
      const trimmed = typeof v === 'string' ? v.trim() : ''
      if (trimmed) target[k] = trimmed
    }
    const now = Date.now()

    await db
      .prepare(D1_UPSERT_CHANNEL_CONFIG_SQL)
      .bind(
        input.ownerId,
        input.channel,
        input.enabled ? 1 : 0,
        minSeverity,
        JSON.stringify(target),
        input.secret?.trim() || '',
        now
      )
      .run()

    return await getChannelConfig(input.ownerId, input.channel)
  } catch (err) {
    warn(
      `failed to upsert ${input.channel} config for owner ${input.ownerId}: ${err}`
    )
    return null
  }
}

/**
 * Delete one channel's config, owner-scoped. Returns whether a row was removed.
 * Best-effort — returns `false` on any store failure. Deleting a config reverts
 * that channel to its env fallback on the next sweep.
 */
export async function deleteChannelConfig(
  ownerId: string,
  channel: AlertConfigChannel
): Promise<boolean> {
  try {
    const db = getDb()
    if (!db) return false
    const res = await db
      .prepare(`DELETE FROM ${TABLE} WHERE owner_id = ?1 AND channel = ?2`)
      .bind(ownerId, channel)
      .run()
    return (res.meta?.changes ?? 0) > 0
  } catch (err) {
    warn(`failed to delete ${channel} config for owner ${ownerId}: ${err}`)
    return false
  }
}
