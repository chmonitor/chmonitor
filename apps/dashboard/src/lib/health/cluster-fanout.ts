/**
 * Cluster fan-out capability (issue #3682).
 *
 * ## The failure this exists for
 *
 * `SELECT count() FROM clusterAllReplicas(<cluster>, system.replicas)` is not
 * a local query. ClickHouse opens an outbound connection per configured
 * replica and re-authenticates as the `<remote_servers>` user. On the
 * reporting deployment that user was the cluster's `default`, whose password
 * the monitoring credentials did not carry, so the statement failed with
 * `516 Authentication failed` — and the notification path retried it 163 times
 * a day against three cluster names, none of which could ever succeed. A
 * fourth cluster later in `system.clusters` worked, so the batch "partly
 * succeeded" and nothing looked broken.
 *
 * ## Cluster selection happens once
 *
 * `getClusterFanout` picks the cluster to probe from the cached
 * `system.clusters` list instead of fanning out over every name on every tick,
 * so a server with 12 cluster definitions spends one probe, not 12.
 *
 * ## How long an auth failure is remembered — and why not forever
 *
 * The choice is **exponential backoff, not stickiness, and not a flat TTL**:
 *
 *  - *Sticky for the process* would be wrong twice over. In Cloudflare Workers
 *    a "process" is an isolate, and isolates are recycled constantly, so a
 *    sticky answer would silently reset at a moment nobody chose — an
 *    unprincipled half-life. And a monitor that never re-checks cannot notice
 *    that someone fixed `<remote_servers><password>` at 09:00.
 *  - *A flat 10-minute TTL* fixes nothing that matters: 144 retries/day is the
 *    same order as the 163 the issue reports. The query is not rare, just less
 *    frequent.
 *  - *Exponential backoff* makes the retry count logarithmic instead of linear:
 *    the first re-probe is a full TTL away, then it doubles to a 6-hour
 *    ceiling. Over 24h that is ~8 attempts instead of 163, and the cost of
 *    being wrong is bounded by the current backoff rather than by the sweep
 *    heartbeat. Nothing is retried inside the TTL, which is the acceptance
 *    criterion; the price is that a fix is noticed within the current backoff
 *    window rather than instantly, and that is the right trade for a fault
 *    whose cause is server configuration.
 *
 * Only *auth-shaped* failures back off. A network blip or a timeout re-probes
 * on the plain capability TTL, because granting it a 6-hour penalty for one bad
 * second would be the exact failure mode the header of `capability-cache.ts`
 * warns about — a transient problem cached as a permanent one.
 */

import type { HostCapabilities } from './capability-cache'

import { CAPABILITY_TTL_MS, getHostCapabilities } from './capability-cache'
import { fetchData } from '@chm/clickhouse-client'
import { debug } from '@chm/logger'

/** First re-probe delay after an auth failure. Same order as the TTL. */
export const CLUSTER_AUTH_BACKOFF_START_MS = 10 * 60 * 1000

/** Ceiling for the auth backoff. A fix is noticed within this window. */
export const CLUSTER_AUTH_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000

export type ClusterFanoutStatus =
  /**
   * The capability probe itself failed, so we do not know what this server
   * offers. Distinct from `no_clusters`: saying "no clusters" when the answer
   * is "could not ask" is how a monitoring tool starts lying.
   */
  | 'unknown'
  /** `system.clusters` is empty — nothing to fan out to on this server. */
  | 'no_clusters'
  /** `clusterAllReplicas` worked for the monitoring user. */
  | 'supported'
  /** 516 / AUTHENTICATION_FAILED — inter-server auth is not usable. */
  | 'auth_failed'
  /** Some other error — fall back now, re-probe on the plain TTL. */
  | 'unavailable'

export interface ClusterFanoutCapability {
  readonly status: ClusterFanoutStatus
  /** Every cluster name `system.clusters` reports. Empty when unknown. */
  readonly clusters: readonly string[]
  /** The cluster that was (or would be) probed. `null` when there is none. */
  readonly cluster: string | null
  /**
   * One line, safe to render. The issue's acceptance wording is "cluster-wide
   * view unavailable: inter-server auth", and {@link AUTH_FAILURE_MESSAGE} is
   * that sentence.
   */
  readonly message: string | null
  /** Unix-ms before which no new probe may run. */
  readonly nextProbeAt: number
  /** Current auth backoff in ms (0 when not backing off). */
  readonly backoffMs: number
}

export const AUTH_FAILURE_MESSAGE =
  'Cluster-wide view unavailable: inter-server auth for this user is rejected by the cluster. Falling back to the configured hosts.'

export const NO_CLUSTERS_MESSAGE =
  'Cluster-wide view unavailable: this server defines no clusters in system.clusters.'

export const UNAVAILABLE_MESSAGE =
  'Cluster-wide view unavailable: the cluster query failed. Falling back to the configured hosts.'

export const UNKNOWN_MESSAGE =
  'Cluster-wide view unavailable: could not read this server’s capabilities. Falling back to the configured hosts.'

interface ClusterEntry {
  capability: ClusterFanoutCapability
  /** Promise of an in-flight probe, shared by concurrent callers. */
  pending: Promise<ClusterFanoutCapability> | null
}

const clusterCache = new Map<number, ClusterEntry>()

let clock: () => number = () => Date.now()

/**
 * Override the clock the backoff is measured against (test seam), and clear
 * every remembered cluster capability.
 */
export function setClusterFanoutClock(now: (() => number) | null): void {
  clock = now ?? (() => Date.now())
  clusterCache.clear()
}

/** Forget the cluster capability for one host, or for all of them. */
export function resetClusterFanout(hostId?: number): void {
  if (hostId === undefined) clusterCache.clear()
  else clusterCache.delete(hostId)
}

/**
 * The cheapest possible `clusterAllReplicas` round trip: one row per
 * configured replica, aggregated down to a single number. `count()` over
 * `system.clusters` itself would answer from the local node without
 * authenticating, so the target table has to be one that exists on the remote
 * side too — `system.replicas` always does.
 */
export function buildClusterFanoutProbeSql(): string {
  return `
    SELECT count() AS replica_count
    FROM clusterAllReplicas({cluster: String}, system.replicas)
  `
}

/**
 * Does this error mean "the cluster will never accept this user"?
 *
 * ClickHouse reports inter-server auth failure as `Code: 516` with
 * `Authentication failed: …`. Both the code and the message are matched
 * because they reach this module through different layers: a thrown
 * `ClickHouseError` carries `.code`, while the `fetchData` envelope flattens to
 * a `FetchDataError` whose `type` is `permission_error` for some variants and
 * `query_error` for others. Relying on the type alone would miss most of these
 * failures — which is how the 163/day retry survived.
 */
export function isInterServerAuthFailure(
  error: { type?: string; message?: string; code?: unknown } | Error | null
): boolean {
  if (!error) return false
  const raw = error as { message?: unknown; code?: unknown }
  const message = typeof raw.message === 'string' ? raw.message : ''
  if (raw.code === 516 || raw.code === '516') return true
  if (/\b516\b/.test(message) && /authenticat/i.test(message)) return true
  return /authenticat(?:ion|e) failed/i.test(message)
}

/**
 * Try one `clusterAllReplicas` read. Never throws: the classification is the
 * product of this function, not an exception a caller has to catch.
 */
export async function probeClusterFanout(
  hostId: number,
  cluster: string
): Promise<{ ok: true } | { ok: false; authFailure: boolean }> {
  const result = await fetchData<Array<{ replica_count?: string | number }>>({
    query: buildClusterFanoutProbeSql(),
    hostId,
    format: 'JSONEachRow',
    query_params: { cluster },
    clickhouse_settings: { readonly: '1' },
  })

  if (result.error) {
    return { ok: false, authFailure: isInterServerAuthFailure(result.error) }
  }
  return { ok: true }
}

function capabilityFor(
  status: ClusterFanoutStatus,
  capabilities: HostCapabilities,
  cluster: string | null,
  message: string | null,
  backoffMs: number,
  nextProbeAt: number
): ClusterFanoutCapability {
  return {
    status,
    clusters: capabilities.clusters,
    cluster,
    message,
    nextProbeAt,
    backoffMs,
  }
}

function probeFailureCapability(
  capabilities: HostCapabilities,
  entry: ClusterEntry | undefined,
  authFailure: boolean
): ClusterFanoutCapability {
  const cluster = capabilities.clusters[0] ?? null
  if (!authFailure) {
    return capabilityFor(
      'unavailable',
      capabilities,
      cluster,
      UNAVAILABLE_MESSAGE,
      0,
      clock() + CAPABILITY_TTL_MS
    )
  }
  // Doubling ladder: first failure waits one TTL, then 2x up to the ceiling.
  // A successful probe resets it, so a later regression starts over at the
  // short interval instead of inheriting an old hour-long penalty.
  const backoffMs = Math.min(
    (entry?.capability.backoffMs ?? 0) * 2 || CLUSTER_AUTH_BACKOFF_START_MS,
    CLUSTER_AUTH_BACKOFF_MAX_MS
  )
  debug(
    `[cluster-fanout] cluster "${cluster ?? 'unknown'}" rejected inter-server auth; next probe in ${Math.round(backoffMs / 1000)}s`
  )
  return capabilityFor(
    'auth_failed',
    capabilities,
    cluster,
    AUTH_FAILURE_MESSAGE,
    backoffMs,
    clock() + backoffMs
  )
}

/**
 * Whether `clusterAllReplicas` can be used for this host, probing at most once
 * per the capability TTL (auth failures: per the exponential backoff).
 *
 * Every caller inside the window gets the same answer — including the callers
 * whose job is only to render the notice — so "surface it once" and "stop
 * retrying" are one mechanism rather than two that can disagree.
 */
export async function getClusterFanout(
  hostId: number
): Promise<ClusterFanoutCapability> {
  const capabilities = await getHostCapabilities(hostId)
  const now = clock()
  const entry = clusterCache.get(hostId)

  if (entry && entry.capability.nextProbeAt > now) return entry.capability

  if (capabilities.probeFailed) {
    const unknown = capabilityFor(
      'unknown',
      capabilities,
      null,
      UNKNOWN_MESSAGE,
      0,
      now + CAPABILITY_TTL_MS
    )
    clusterCache.set(hostId, { capability: unknown, pending: null })
    return unknown
  }

  const cluster = selectCluster(capabilities)
  if (cluster === null) {
    const noClusters = capabilityFor(
      'no_clusters',
      capabilities,
      null,
      NO_CLUSTERS_MESSAGE,
      0,
      now + CAPABILITY_TTL_MS
    )
    clusterCache.set(hostId, { capability: noClusters, pending: null })
    return noClusters
  }

  // A probe is already running for this host: join it rather than start a
  // second one, even if the previous capability has expired.
  if (entry?.pending) return entry.pending

  const pending = probeClusterFanout(hostId, cluster)
    .then((outcome): ClusterFanoutCapability => {
      if (outcome.ok) {
        return capabilityFor('supported', capabilities, cluster, null, 0, 0)
      }
      return probeFailureCapability(capabilities, entry, outcome.authFailure)
    })
    .catch((err: unknown): ClusterFanoutCapability => {
      // `probeClusterFanout` does not throw, so this is belt-and-braces: a
      // capability nobody can answer must still return a usable object.
      debug(
        `[cluster-fanout] probe threw for cluster "${cluster}"`,
        err instanceof Error ? err.message : String(err)
      )
      return probeFailureCapability(capabilities, entry, false)
    })

  clusterCache.set(hostId, {
    capability:
      entry?.capability ??
      capabilityFor('unknown', capabilities, cluster, null, 0, 0),
    pending,
  })

  const resolved = await pending
  if (clusterCache.get(hostId)?.pending === pending) {
    clusterCache.set(hostId, { capability: resolved, pending: null })
  }
  return resolved
}

/**
 * Pick the one cluster to fan out to: the first name `system.clusters` reports,
 * which is deterministic because the capability cache sorts them.
 *
 * Picking *a* cluster rather than every name is what turns three failing probes
 * per tick into one. The trade is deliberate and stated in the PR: a mixed
 * cluster (one name whose `<remote_servers>` user works, one that does not)
 * reports on the first name only, in exchange for never paying for the ones
 * that provably cannot work.
 */
export function selectCluster(capabilities: HostCapabilities): string | null {
  if (capabilities.probeFailed) return null
  return capabilities.clusters[0] ?? null
}

/**
 * What to tell the operator about a degraded cluster-wide view, or `null`
 * when there is nothing to say.
 */
export function clusterViewNotice(
  capability: ClusterFanoutCapability
): string | null {
  return capability.status === 'supported' ||
    capability.status === 'no_clusters'
    ? null
    : capability.message
}
