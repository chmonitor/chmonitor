/**
 * Per-rule / per-host alert routing (plans/30-per-rule-alert-routing.md).
 *
 * Today the health sweep (`server-sweep.ts`) posts every notifying finding to
 * one global webhook (`HEALTH_ALERT_WEBHOOK_URL`). This module lets an
 * operator define **routes** that match a rule id/type and/or host (glob or
 * `*`) to one or more channel webhook URLs, so different conditions can fan
 * out to different Slack/Discord/PagerDuty/etc destinations.
 *
 * Two layers, deliberately separated:
 *
 *   - PURE core ({@link matchRoutes} / {@link resolveTargets}) — no I/O, fully
 *     unit-testable, and the thing the sweep actually calls per finding.
 *   - D1-backed CRUD ({@link listRoutes} / {@link createRoute} /
 *     {@link deleteRoute}) — mirrors `insights/store/d1-store.ts` and
 *     `alert-history-store.ts`: best-effort, NEVER throws. A missing D1
 *     binding, an unmigrated table, or any other D1 error resolves to `[]` /
 *     `void` rather than throwing.
 *
 * Fail-open guarantee (self-hosted stays whole): {@link listRoutes} degrading
 * to `[]` means {@link matchRoutes} also returns `[]`, so
 * {@link resolveTargets} falls back to the legacy global webhook URL —
 * TODAY'S BEHAVIOR EXACTLY for deployments that never configure a route.
 */

import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const COMPONENT = 'alert-routing'
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[alert-routing] ${msg}`, { component: COMPONENT })

const TABLE = 'alert_routes'

/** A configured alert route: match criteria → destination channel. */
export interface AlertRoute {
  id: string
  ownerId: string
  /** Rule id, rule type, or `*` (any rule). May be a glob, e.g. `disk-*`. */
  matchRule: string
  /** Host id, host name, or `*` (any host). May be a glob. */
  matchHost: string
  channelUrl: string
  enabled: boolean
  createdAt: number
}

interface D1AlertRouteRow {
  id: string
  owner_id: string
  match_rule: string
  match_host: string
  channel_url: string
  enabled: number
  created_at: number
}

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

function rowToRoute(row: D1AlertRouteRow): AlertRoute {
  return {
    id: row.id,
    ownerId: row.owner_id,
    matchRule: row.match_rule,
    matchHost: row.match_host,
    channelUrl: row.channel_url,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  }
}

/**
 * List every enabled+disabled route for an owner, best-effort. Returns `[]`
 * when D1 isn't configured (self-hosted/OSS default) or on any store error —
 * NEVER throws, so a routing-table hiccup can never break the sweep or the
 * routes UI's initial load.
 */
export async function listRoutes(ownerId: string): Promise<AlertRoute[]> {
  try {
    const db = getDb()
    if (!db) return []

    const result = await db
      .prepare(
        `SELECT id, owner_id, match_rule, match_host, channel_url, enabled, created_at
         FROM ${TABLE}
         WHERE owner_id = ?1
         ORDER BY created_at DESC`
      )
      .bind(ownerId)
      .all<D1AlertRouteRow>()

    return (result.results ?? []).map(rowToRoute)
  } catch (err) {
    warn(`failed to list routes for owner ${ownerId}: ${err}`)
    return []
  }
}

export interface CreateRouteInput {
  ownerId: string
  matchRule: string
  matchHost: string
  channelUrl: string
  enabled?: boolean
}

/**
 * Create a route. Best-effort — returns `null` on any store failure instead
 * of throwing, so a D1 hiccup surfaces as "nothing created" rather than a
 * 500 that could be mistaken for a partially-applied write.
 */
export async function createRoute(
  input: CreateRouteInput
): Promise<AlertRoute | null> {
  try {
    const db = getDb()
    if (!db) return null

    const route: AlertRoute = {
      id: crypto.randomUUID(),
      ownerId: input.ownerId,
      matchRule: input.matchRule.trim() || '*',
      matchHost: input.matchHost.trim() || '*',
      channelUrl: input.channelUrl.trim(),
      enabled: input.enabled ?? true,
      createdAt: Date.now(),
    }

    await db
      .prepare(
        `INSERT INTO ${TABLE}
           (id, owner_id, match_rule, match_host, channel_url, enabled, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      )
      .bind(
        route.id,
        route.ownerId,
        route.matchRule,
        route.matchHost,
        route.channelUrl,
        route.enabled ? 1 : 0,
        route.createdAt
      )
      .run()

    return route
  } catch (err) {
    warn(`failed to create route for owner ${input.ownerId}: ${err}`)
    return null
  }
}

/**
 * Delete a route, owner-scoped (a caller can never delete another owner's
 * route by guessing its id). Returns whether a row was actually removed.
 * Best-effort — returns `false` on any store failure instead of throwing.
 */
export async function deleteRoute(
  ownerId: string,
  id: string
): Promise<boolean> {
  try {
    const db = getDb()
    if (!db) return false

    const res = await db
      .prepare(`DELETE FROM ${TABLE} WHERE id = ?1 AND owner_id = ?2`)
      .bind(id, ownerId)
      .run()

    return (res.meta?.changes ?? 0) > 0
  } catch (err) {
    warn(`failed to delete route ${id} for owner ${ownerId}: ${err}`)
    return false
  }
}

// --- Pure matching core ------------------------------------------------------

/**
 * Convert a `*`/`?`-glob into a case-insensitive `RegExp`. `*` matches any
 * sequence (including empty), `?` matches exactly one character; everything
 * else is matched literally. A bare `*` (the common "any" case) short-circuits
 * to `/^.*$/` rather than compiling, but is handled by the caller anyway (see
 * {@link matchesPattern}).
 */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const pattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${pattern}$`, 'i')
}

/** `*` always matches; otherwise glob-match against every candidate value. */
function matchesPattern(
  pattern: string,
  candidates: readonly (string | undefined)[]
): boolean {
  if (pattern === '*') return true
  const re = globToRegExp(pattern)
  return candidates.some((c) => c !== undefined && re.test(c))
}

/** The finding attributes a route is matched against. */
export interface RouteMatchTarget {
  ruleId: string
  ruleType: string
  hostId: number
  hostName: string
}

/**
 * Pure core: given the full route set and a finding's identity, return every
 * ENABLED route whose `matchRule` (against rule id OR type) and `matchHost`
 * (against host id OR name) both match. No I/O — fully unit-testable.
 */
export function matchRoutes(
  routes: readonly AlertRoute[],
  target: RouteMatchTarget
): AlertRoute[] {
  return routes.filter((route) => {
    if (!route.enabled) return false
    if (!matchesPattern(route.matchRule, [target.ruleId, target.ruleType])) {
      return false
    }
    return matchesPattern(route.matchHost, [
      String(target.hostId),
      target.hostName,
    ])
  })
}

/**
 * Resolve the channel URLs a finding should be dispatched to: every matched
 * route's `channelUrl` (deduplicated), or `[legacyGlobalUrl]` when nothing
 * matches and a global URL is configured — preserving today's single-webhook
 * behavior for deployments that never configure a route. Returns `[]` only
 * when there is no match AND no legacy URL configured.
 */
export function resolveTargets(
  routes: readonly AlertRoute[],
  target: RouteMatchTarget,
  legacyGlobalUrl: string
): string[] {
  const matched = matchRoutes(routes, target)
  if (matched.length > 0) {
    return [...new Set(matched.map((r) => r.channelUrl))]
  }
  return legacyGlobalUrl ? [legacyGlobalUrl] : []
}
