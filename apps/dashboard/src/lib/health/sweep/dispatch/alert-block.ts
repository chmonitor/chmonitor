/**
 * Opt-in structured `alert` block for custom webhook targets and webhook
 * subscriptions (#3998, #4049). {@link buildAlertBlock} is pure: it derives
 * trend / repeatCount from the state record read BEFORE `evaluateAlert`, so it
 * never depends on the not-yet-committed next record.
 * {@link createAlertBlockResolver} adds the two reads (alert history for
 * `firstSeenAt`, ClickHouse for `topContributors`) once per finding, only when
 * a destination opted in.
 */

import type {
  AlertBlock,
  AlertContributor,
  AlertUntrusted,
} from './../../adapters'
import type {
  AlertDecisionKind,
  AlertStateRecord,
} from './../../alert-state-store'

import { queryFirstSeenInEpisode } from './../../alert-history-store'
import { fetchTopContributors } from './alert-contributors'
import { redactSecrets } from '@/lib/ai/agent/errors'

/** Longest cluster-originated string the block carries. */
export const UNTRUSTED_STRING_MAX = 200
/** Cap on what is redacted, so a huge string costs bounded work. */
const REDACT_INPUT_MAX = 4 * 1024

/** Redact first (so truncation cannot split a secret past its pattern), then cut. */
export function sanitizeUntrusted(value: string): string {
  const redacted = redactSecrets(value.slice(0, REDACT_INPUT_MAX))
  return redacted.length > UNTRUSTED_STRING_MAX
    ? `${redacted.slice(0, UNTRUSTED_STRING_MAX - 1)}…`
    : redacted
}

function sanitizeContributor(c: AlertContributor): AlertContributor {
  if (c.kind === 'table') {
    return {
      ...c,
      database: sanitizeUntrusted(c.database),
      table: sanitizeUntrusted(c.table),
    }
  }
  return {
    ...c,
    queryId: sanitizeUntrusted(c.queryId),
    user: sanitizeUntrusted(c.user),
    normalizedQuery: sanitizeUntrusted(c.normalizedQuery),
  }
}

/**
 * ISO-8601 incident start from alert state (a new incident starts now; an open
 * one keeps its recorded `firstFiredAt`), or undefined when unknown. Needs no
 * history store, so the `{{firstFired}}` template variable can fall back to it
 * where `alert.firstSeenAt` is null.
 */
export function incidentStartedAt(
  kind: AlertDecisionKind,
  previousState: AlertStateRecord | undefined,
  now: string
): string | undefined {
  if (kind === 'new') return now
  const started = previousState?.firstFiredAt
  return started === undefined ? undefined : new Date(started).toISOString()
}

export interface AlertBlockParams {
  ruleId: string
  kind: AlertDecisionKind
  /** Severity the alert is at, or the one a recovery resolved from. */
  severity: 'warning' | 'critical'
  value: number | null
  previousValue: number | undefined
  previousState: AlertStateRecord | undefined
  warnThreshold?: number | null
  critThreshold?: number | null
  affected: readonly string[]
  /** First recorded event of this episode, from alert history. */
  firstSeenAt: string | null
  topContributors?: AlertContributor[]
  /** ISO-8601 time of this dispatch; the start of a brand-new episode. */
  now: string
}

export function buildAlertBlock(params: AlertBlockParams): AlertBlock {
  const { value, previousValue } = params
  let trend: AlertBlock['trend'] = null
  if (value !== null && previousValue !== undefined) {
    trend =
      value > previousValue
        ? 'rising'
        : value < previousValue
          ? 'falling'
          : 'flat'
  }
  const threshold =
    (params.severity === 'critical'
      ? params.critThreshold
      : params.warnThreshold) ?? null
  const untrusted: AlertUntrusted = {
    affected: params.affected.map(sanitizeUntrusted),
  }
  if (params.topContributors?.length) {
    untrusted.topContributors = params.topContributors.map(sanitizeContributor)
  }
  return {
    ruleId: params.ruleId,
    metric: params.ruleId,
    threshold,
    value,
    previousValue: previousValue ?? null,
    trend,
    firstSeenAt:
      params.firstSeenAt ?? (params.kind === 'new' ? params.now : null),
    repeatCount: params.previousState?.repeatCount ?? 0,
    untrusted,
  }
}

export interface AlertBlockReads {
  firstSeen: (
    hostId: number,
    ruleId: string,
    before: string
  ) => Promise<string | null>
  contributors: (
    ruleId: string,
    hostId: number
  ) => Promise<AlertContributor[] | undefined>
}

const defaultReads: AlertBlockReads = {
  firstSeen: queryFirstSeenInEpisode,
  contributors: (ruleId, hostId) => fetchTopContributors(ruleId, hostId),
}

export interface AlertBlockResolver {
  /** Operator-configured custom webhook targets: with `topContributors`. */
  forTarget: () => Promise<AlertBlock>
  /**
   * User-created webhook subscriptions: never `topContributors`. Those are
   * other users' normalized SQL, user names and query ids from the operator's
   * hosts, which a signed-in user must not receive.
   */
  forSubscription: () => Promise<AlertBlock>
}

/**
 * Memoized, lazy builders for one finding: nothing is read until a target or
 * subscription with `details: true` asks, and callers share the reads.
 * Contributors are read only for `forTarget`, never for a recovery. Never
 * rejects: both reads are best-effort and resolve to "unknown".
 */
export function createAlertBlockResolver(
  params: Omit<AlertBlockParams, 'firstSeenAt' | 'topContributors'> & {
    hostId: number
  },
  reads: AlertBlockReads = defaultReads
): AlertBlockResolver {
  let firstSeen: Promise<string | null> | undefined
  let contributors: Promise<AlertContributor[] | undefined> | undefined
  let target: Promise<AlertBlock> | undefined
  let subscription: Promise<AlertBlock> | undefined
  const readFirstSeen = () =>
    (firstSeen ??= reads
      .firstSeen(params.hostId, params.ruleId, params.now)
      .catch(() => null))
  const readContributors = () =>
    (contributors ??=
      params.kind === 'recovery'
        ? Promise.resolve(undefined)
        : reads
            .contributors(params.ruleId, params.hostId)
            .catch(() => undefined))
  return {
    forTarget: () =>
      (target ??= (async () => {
        const [firstSeenAt, topContributors] = await Promise.all([
          readFirstSeen(),
          readContributors(),
        ])
        return buildAlertBlock({ ...params, firstSeenAt, topContributors })
      })()),
    forSubscription: () =>
      (subscription ??= readFirstSeen().then((firstSeenAt) =>
        buildAlertBlock({ ...params, firstSeenAt })
      )),
  }
}
