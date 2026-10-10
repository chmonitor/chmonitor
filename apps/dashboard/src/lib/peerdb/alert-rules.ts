/**
 * PeerDB alert rules (#3699) — per-mirror thresholds and mutes.
 *
 * A rule targets one mirror-health check (`lag`, `slot-lag`, `errors`,
 * `stale-sync`) on the mirrors whose name matches `match`, and replaces that
 * check's warn/crit pair from `DEFAULT_PEERDB_ALERT_THRESHOLDS`. Rules come
 * from Alert Settings (D1/Postgres) and from `alerts.yaml` `peerdbRules`; the
 * store (`alert-rules-store.ts`) merges both. Everything in this module is
 * pure and client-safe.
 *
 * Precedence, per check: among the ENABLED rules for that check whose pattern
 * matches the mirror, the most specific wins —
 *
 *   1. `exact`  (the mirror name itself)
 *   2. `prefix` (longer prefix wins)
 *   3. `glob`   (more literal characters wins; `*` and `?` do not count)
 *
 * A remaining tie goes to the lower `id` (string order), so the result never
 * depends on list order. Checks with no matching rule keep the defaults, so
 * an empty rule list is exactly today's behaviour. All matching is
 * case-insensitive, like the routing globs.
 *
 * `severity: 'warning'` caps the rule's check at warning: its critical
 * threshold is ignored. Mute is mirror-wide: while any enabled matching rule
 * has `muteUntil` in the future, the mirror is still evaluated and audited,
 * but nothing is dispatched for it (see `runPeerDBAlertCycle`).
 */

import { z } from 'zod'

import {
  DEFAULT_PEERDB_ALERT_THRESHOLDS,
  type PeerDBAlertThresholds,
} from './alerting'
import { globToRegExp } from '@/lib/health/glob'

export const PEERDB_RULE_CHECKS = [
  'lag',
  'slot-lag',
  'errors',
  'stale-sync',
] as const
export type PeerDBRuleCheck = (typeof PEERDB_RULE_CHECKS)[number]

export const PEERDB_RULE_MATCH_KINDS = ['exact', 'prefix', 'glob'] as const
export type PeerDBRuleMatchKind = (typeof PEERDB_RULE_MATCH_KINDS)[number]

/** `critical` = both thresholds apply; `warning` = never escalate past warn. */
export const PEERDB_RULE_SEVERITIES = ['critical', 'warning'] as const
export type PeerDBRuleSeverity = (typeof PEERDB_RULE_SEVERITIES)[number]

export interface PeerDBRule {
  id: string
  check: PeerDBRuleCheck
  matchKind: PeerDBRuleMatchKind
  /** Mirror name, prefix, or glob depending on `matchKind`. */
  match: string
  warning: number
  critical: number
  severity: PeerDBRuleSeverity
  enabled: boolean
  /** Epoch ms; mute is active while `now < muteUntil`. `null` = not muted. */
  muteUntil: number | null
}

/** Which threshold pair each check owns, and its unit for display. */
export const PEERDB_RULE_CHECK_FIELDS: Record<
  PeerDBRuleCheck,
  {
    warn: keyof PeerDBAlertThresholds
    crit: keyof PeerDBAlertThresholds
    label: string
    unit: string
  }
> = {
  lag: {
    warn: 'lagWarnSec',
    crit: 'lagErrorSec',
    label: 'CDC lag',
    unit: 'seconds',
  },
  'slot-lag': {
    warn: 'slotLagWarnMb',
    crit: 'slotLagErrorMb',
    label: 'Replication slot lag',
    unit: 'MB',
  },
  errors: {
    warn: 'errorWarnCount',
    crit: 'errorErrorCount',
    label: 'Recent errors',
    unit: 'errors',
  },
  'stale-sync': {
    warn: 'staleSyncWarnSec',
    crit: 'staleSyncErrorSec',
    label: 'Stale sync',
    unit: 'seconds since last batch',
  },
}

/**
 * Field rules shared by the API body and the `alerts.yaml` entry: a non-empty
 * pattern, finite non-negative thresholds, and `warning <= critical` (every
 * check fires when the value is at or above the threshold).
 */
export const peerDBRuleFieldsSchema = z
  .object({
    check: z.enum(PEERDB_RULE_CHECKS),
    matchKind: z.enum(PEERDB_RULE_MATCH_KINDS).default('glob'),
    match: z.string().trim().min(1).max(256),
    warning: z.number().finite().min(0),
    critical: z.number().finite().min(0),
    severity: z.enum(PEERDB_RULE_SEVERITIES).default('critical'),
    enabled: z.boolean().default(true),
  })
  .refine((r) => r.warning <= r.critical, {
    message: 'warning must be less than or equal to critical',
    path: ['warning'],
  })

function matches(rule: PeerDBRule, name: string): boolean {
  const target = name.toLowerCase()
  const pattern = rule.match.toLowerCase()
  switch (rule.matchKind) {
    case 'exact':
      return target === pattern
    case 'prefix':
      return target.startsWith(pattern)
    case 'glob':
      return globToRegExp(rule.match).test(name)
  }
}

/** Higher = more specific. See the module docblock for the order. */
export function peerDBRuleSpecificity(rule: PeerDBRule): number {
  switch (rule.matchKind) {
    case 'exact':
      return 3_000_000
    case 'prefix':
      return 2_000_000 + rule.match.length
    case 'glob':
      return 1_000_000 + rule.match.replace(/[*?]/g, '').length
  }
}

/** Enabled rules that match `name`, most specific first (ties by `id`). */
export function matchingPeerDBRules(
  name: string,
  rules: readonly PeerDBRule[]
): PeerDBRule[] {
  return rules
    .filter((r) => r.enabled && matches(r, name))
    .sort(
      (a, b) =>
        peerDBRuleSpecificity(b) - peerDBRuleSpecificity(a) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
}

/**
 * Thresholds for one mirror: `base` (the defaults), with each check's pair
 * replaced by its most specific matching rule. Pure.
 */
export function thresholdsForMirror(
  name: string,
  rules: readonly PeerDBRule[],
  base: PeerDBAlertThresholds = DEFAULT_PEERDB_ALERT_THRESHOLDS
): PeerDBAlertThresholds {
  const out: PeerDBAlertThresholds = { ...base }
  const decided = new Set<PeerDBRuleCheck>()
  for (const rule of matchingPeerDBRules(name, rules)) {
    if (decided.has(rule.check)) continue
    decided.add(rule.check)
    const fields = PEERDB_RULE_CHECK_FIELDS[rule.check]
    out[fields.warn] = rule.warning
    out[fields.crit] =
      rule.severity === 'warning' ? Number.POSITIVE_INFINITY : rule.critical
  }
  return out
}

/** The enabled matching rule muting `name` at `now`, if any. Pure. */
export function mutingPeerDBRule(
  name: string,
  rules: readonly PeerDBRule[],
  now: number
): PeerDBRule | null {
  return (
    matchingPeerDBRules(name, rules).find(
      (r) => r.muteUntil !== null && now < r.muteUntil
    ) ?? null
  )
}
