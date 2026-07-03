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

/**
 * Route destination provider. `'webhook'` (default) fans out to
 * `channelUrl` exactly as plan 30 shipped — Slack/Discord/generic JSON.
 * `'pagerduty'` (plan 34) routes to a PagerDuty service's Events API v2
 * integration key (`routingKey`) instead, letting PagerDuty apply that
 * service's own escalation policy + on-call schedule.
 */
export type AlertRouteProvider = 'webhook' | 'pagerduty'

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
  /** Destination provider; defaults to `'webhook'` for plan-30 rows. */
  provider: AlertRouteProvider
  /** Display label for a PagerDuty service (provider `'pagerduty'` only). */
  serviceName: string | null
  /** PagerDuty Events API v2 integration/routing key (provider `'pagerduty'` only). */
  routingKey: string | null
}

interface D1AlertRouteRow {
  id: string
  owner_id: string
  match_rule: string
  match_host: string
  channel_url: string
  enabled: number
  created_at: number
  provider: string | null
  service_name: string | null
  routing_key: string | null
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
    // Legacy plan-30 rows have no `provider` column value yet (pre-migration
    // fake D1s in tests, or a row inserted before 0016 ran) — default to the
    // webhook behavior they already have.
    provider: row.provider === 'pagerduty' ? 'pagerduty' : 'webhook',
    serviceName: row.service_name ?? null,
    routingKey: row.routing_key ?? null,
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
        `SELECT id, owner_id, match_rule, match_host, channel_url, enabled, created_at,
                provider, service_name, routing_key
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
  /** Defaults to `'webhook'` — plan-30 behavior unchanged. */
  provider?: AlertRouteProvider
  /** Display label for a PagerDuty service (provider `'pagerduty'` only). */
  serviceName?: string | null
  /** PagerDuty Events API v2 integration/routing key (provider `'pagerduty'` only). */
  routingKey?: string | null
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
      provider: input.provider ?? 'webhook',
      serviceName: input.serviceName?.trim() || null,
      routingKey: input.routingKey?.trim() || null,
    }

    await db
      .prepare(
        `INSERT INTO ${TABLE}
           (id, owner_id, match_rule, match_host, channel_url, enabled, created_at,
            provider, service_name, routing_key)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
      )
      .bind(
        route.id,
        route.ownerId,
        route.matchRule,
        route.matchHost,
        route.channelUrl,
        route.enabled ? 1 : 0,
        route.createdAt,
        route.provider,
        route.serviceName,
        route.routingKey
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
 * `'webhook'`-provider route's `channelUrl` (deduplicated), or
 * `[legacyGlobalUrl]` when NO route matched at all (any provider) and a
 * global URL is configured — preserving today's single-webhook behavior for
 * deployments that never configure a route. Returns `[]` when there is no
 * legacy URL configured, OR when a `'pagerduty'` route matched instead: an
 * explicit route (plan 30's precedent — "matched routes take precedence, the
 * legacy URL is a fallback only when nothing matches") always suppresses the
 * catch-all, even one belonging to the other provider — otherwise an
 * operator who explicitly routed a rule to PagerDuty would ALSO get paged on
 * the legacy Slack/Discord webhook for the same finding (plan 34).
 */
export function resolveTargets(
  routes: readonly AlertRoute[],
  target: RouteMatchTarget,
  legacyGlobalUrl: string
): string[] {
  const matched = matchRoutes(routes, target)
  // 'pagerduty' routes (plan 34) are dispatched separately by
  // {@link resolvePagerDutyTargets} with a PagerDuty-shaped body, never the
  // generic `{ text, content }` wrapper this path sends — but a pagerduty
  // match still counts toward "something matched" for the fallback decision
  // below.
  const webhookMatched = matched.filter((r) => r.provider === 'webhook')
  if (webhookMatched.length > 0) {
    return [...new Set(webhookMatched.map((r) => r.channelUrl))]
  }
  if (matched.length > 0) return []
  return legacyGlobalUrl ? [legacyGlobalUrl] : []
}

/** One PagerDuty dispatch target: a service's display name + routing key. */
export interface PagerDutyTarget {
  serviceName: string
  routingKey: string
}

/**
 * Resolve the PagerDuty services a finding should page (plan 34 — extends
 * plan 30's routing model rather than a parallel one): every ENABLED,
 * matched route with `provider === 'pagerduty'` and a non-empty
 * `routingKey`, deduplicated by routing key. When NO route matched at all
 * (any provider), falls back to `[{ serviceName: 'default', routingKey:
 * envFallbackKey }]` when `envFallbackKey` is configured — preserving
 * today's single-integration-key behavior for deployments that never
 * configure a PagerDuty route. Returns `[]` when there is no env key
 * configured, OR when a `'webhook'` route matched instead — mirrors
 * {@link resolveTargets}'s cross-provider suppression: an operator who
 * explicitly routed a rule to Slack/Discord must not ALSO get it paged to
 * the env-configured PagerDuty service. Pure — no I/O.
 */
export function resolvePagerDutyTargets(
  routes: readonly AlertRoute[],
  target: RouteMatchTarget,
  envFallbackKey: string
): PagerDutyTarget[] {
  const matched = matchRoutes(routes, target)
  const pagerDutyMatched = matched.filter(
    (r): r is AlertRoute & { routingKey: string } =>
      r.provider === 'pagerduty' && Boolean(r.routingKey)
  )

  if (pagerDutyMatched.length > 0) {
    const seen = new Set<string>()
    const out: PagerDutyTarget[] = []
    for (const r of pagerDutyMatched) {
      if (seen.has(r.routingKey)) continue
      seen.add(r.routingKey)
      out.push({
        serviceName: r.serviceName || 'PagerDuty',
        routingKey: r.routingKey,
      })
    }
    return out
  }

  if (matched.length > 0) return []

  return envFallbackKey
    ? [{ serviceName: 'default', routingKey: envFallbackKey }]
    : []
}
