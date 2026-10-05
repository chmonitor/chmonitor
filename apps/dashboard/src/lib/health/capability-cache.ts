/**
 * Per-host ClickHouse capability cache (issue #3682).
 *
 * ## What this replaces
 *
 * Three different places used to re-ask a ClickHouse server questions whose
 * answers cannot change while it is running:
 *
 *  - `sweep/run-host.ts` ran `SELECT concat(database,'.',name) FROM
 *    system.tables WHERE database='system'` on **every** sweep tick, purely to
 *    decide which optional rules to skip.
 *  - `current-findings.ts` and `alert-suggestions-compute.ts` each ran the
 *    same probe again, on their own cadence.
 *  - Every `tableCheck` on a chart or rule sent its own
 *    `SELECT COUNT() FROM system.tables WHERE database=? AND name=?` — 290/day
 *    for one chart alone on the reporting deployment.
 *
 * ## The one query
 *
 * A single probe per host answers all of it in one round trip: which
 * `system.*` tables exist, which app-owned (`clickhouse_monitoring_*`) tables
 * exist, and which clusters `system.clusters` knows about. The two halves are
 * `UNION ALL`-ed so the whole thing is a single statement — measured on
 * ClickHouse 26.7, a `UNION ALL` of one-row branches is one `query_log`
 * `QueryFinish` row, so a tick really does cost one query and not N.
 *
 * The `system.tables` half carries `LOCAL_DATABASES_FILTER` for the reason
 * #3686 established: an unrestricted catalog scan opens one connection per
 * remote-engine table and `max_execution_time` cannot interrupt it. See
 * `lib/clickhouse-local-databases.ts` and the guard test in
 * `local-databases-filter.test.ts`, which scans this file too.
 *
 * ## Scope: process, not disk
 *
 * The cache is module state, so its real lifetime is the Worker isolate (or
 * the Node process). That is deliberate and is the *only* honest scope: a
 * fresh isolate must be able to answer immediately, and a persisted answer
 * about which tables exist is worse than a re-probe after someone runs
 * `CREATE TABLE system.monitoring_events`. A 10-minute TTL bounds the staleness
 * inside a long-lived process; see {@link CAPABILITY_TTL_MS}.
 *
 * ## Never fail closed on a probe error
 *
 * When the probe itself fails the snapshot is marked `probeFailed` and
 * {@link hasTable} answers `true` — i.e. "unknown, assume present". Reading a
 * missing table as missing would silently disable health checks because of a
 * network blip, which is the same class of bug as caching a failure for a
 * query that could succeed.
 */

import { fetchData } from '@chm/clickhouse-client'
import { debug } from '@chm/logger'
import { APP_DATABASE } from '@/lib/app-tables'
import { LOCAL_DATABASES_FILTER } from '@/lib/clickhouse-local-databases'

/**
 * How long one host's capability snapshot is trusted.
 *
 * Ten minutes: long enough that a 5-minute cron tick re-probes at most once
 * per two ticks instead of on every tick (the 163/day retry the issue is about
 * becomes ~2/day), short enough that enabling `system.query_metric_log` or
 * creating an app table is picked up without a redeploy. Table existence only
 * changes when a human changes it, so this number is generous on purpose.
 */
export const CAPABILITY_TTL_MS = 10 * 60 * 1000

/**
 * The single capability snapshot for one host.
 *
 * `probeFailed` is load-bearing: it separates "this server does not have
 * `system.backup_log`" from "we could not find out", which the pre-cache code
 * conflated into a `null` set that callers treated as "run everything".
 */
export interface HostCapabilities {
  /** Fully-qualified `database.table` names present on this host. */
  readonly tables: ReadonlySet<string>
  /** Cluster names from `system.clusters`, sorted. */
  readonly clusters: readonly string[]
  /** True when the probe failed; `tables` is empty and `clusters` is unknown. */
  readonly probeFailed: boolean
  /** Unix-ms when this snapshot was taken. */
  readonly probedAt: number
}

interface CacheEntry {
  /** `null` until the first probe for this entry resolves. */
  snapshot: HostCapabilities | null
  expiresAt: number
  /** Shared by concurrent callers so one miss is one query. */
  pending: Promise<HostCapabilities> | null
}

const EMPTY_SNAPSHOT: HostCapabilities = {
  tables: new Set<string>(),
  clusters: [],
  probeFailed: true,
  probedAt: 0,
}

const cache = new Map<number, CacheEntry>()

/** Diagnostics counters — asserted by the tests, cheap to keep. */
const stats = { probes: 0, cacheHits: 0, probeFailures: 0 }

/**
 * Clock seam for the TTL. Production never calls the setter; tests do, so a
 * 10-minute TTL can be asserted without sleeping for 10 minutes. Not exported
 * through the package's public surface — see `capability-cache.test.ts`.
 */
let clock: () => number = () => Date.now()

/**
 * Override the clock the TTL is measured against. Pass `null` to restore
 * `Date.now()`. Also drops every cached entry, so a test never leaks a fake
 * clock into the next one.
 */
export function setCapabilityCacheClock(now: (() => number) | null): void {
  clock = now ?? (() => Date.now())
  cache.clear()
}

/**
 * Drop cached snapshots. `hostId` omitted clears every host. Exported for
 * tests and for the `/api/v1/health/actions` path, where an operator has just
 * changed DDL and wants the next read to reflect it.
 */
export function resetHostCapabilities(hostId?: number): void {
  if (hostId === undefined) cache.clear()
  else cache.delete(hostId)
}

/**
 * The probe statement. Exported so a test can assert it is exactly what runs,
 * and so a caller that wants to probe a database other than `APP_DATABASE`
 * (a custom `CLICKHOUSE_DATABASE`) does not have to edit the string.
 *
 * Verified verbatim on 23.8.16.16, 24.3.18.7 and 26.7.22.4 — the
 * `UNION ALL` over a derived `SELECT DISTINCT` is the only shape that parses
 * on all three.
 */
export function buildCapabilityProbeSql(
  appDatabase: string = APP_DATABASE
): string {
  return `
    SELECT 'table' AS kind, concat(database, '.', name) AS name
    FROM system.tables
    WHERE database IN ('system', {appDatabase: String})
      AND ${LOCAL_DATABASES_FILTER}
    UNION ALL
    SELECT 'cluster' AS kind, cluster AS name
    FROM (SELECT DISTINCT cluster FROM system.clusters)
  `
}

interface ProbeRow {
  kind?: string
  name?: string
}

async function probe(hostId: number): Promise<HostCapabilities> {
  stats.probes++
  const result = await fetchData<ProbeRow[]>({
    query: buildCapabilityProbeSql(),
    hostId,
    format: 'JSONEachRow',
    query_params: { appDatabase: APP_DATABASE },
    // Same read-only posture the sweep's own queries use (#3685), so a
    // capability probe can never fail on a setting the server disallows.
    clickhouse_settings: { readonly: '1' },
  })

  if (result.error || !Array.isArray(result.data)) {
    stats.probeFailures++
    debug(
      `[capability-cache] probe failed for host ${hostId}`,
      result.error?.message ?? 'no rows returned'
    )
    return { ...EMPTY_SNAPSHOT, probedAt: clock() }
  }

  const tables = new Set<string>()
  const clusters = new Set<string>()
  for (const row of result.data) {
    const name = row?.name
    if (typeof name !== 'string' || name === '') continue
    if (row.kind === 'cluster') clusters.add(name)
    else tables.add(name)
  }

  return {
    tables,
    clusters: [...clusters].sort(),
    probeFailed: false,
    probedAt: clock(),
  }
}

/**
 * This host's capabilities, probing at most once per {@link CAPABILITY_TTL_MS}.
 *
 * Concurrent callers share one probe: a fresh isolate mounting the /health
 * page asks for a dozen capabilities at once, and the pre-cache code fired a
 * dozen identical probes that raced to write the same answer.
 */
export async function getHostCapabilities(
  hostId: number
): Promise<HostCapabilities> {
  const now = clock()
  const entry = cache.get(hostId)

  // Fresh snapshot: serve it without touching the server.
  if (entry?.snapshot && entry.expiresAt > now) {
    stats.cacheHits++
    return entry.snapshot
  }
  // A probe is already in flight for this host: join it rather than start a
  // second one, even if the previous snapshot is stale.
  if (entry?.pending) return entry.pending

  const pending = probe(hostId)
  cache.set(hostId, {
    snapshot: entry?.snapshot ?? null,
    expiresAt: 0,
    pending,
  })

  const snapshot = await pending
  // A later caller may have replaced this entry; never clobber fresher state.
  if (cache.get(hostId)?.pending === pending) {
    cache.set(hostId, {
      snapshot,
      expiresAt: clock() + CAPABILITY_TTL_MS,
      pending: null,
    })
  }
  return snapshot
}

/**
 * Whether `database.table` exists on this host.
 *
 * Answers `true` when the probe failed: existence is then *unknown*, and
 * running the query anyway lets its own error surface, which is strictly more
 * informative than reporting the table as missing.
 */
export function hasTable(
  capabilities: HostCapabilities,
  qualifiedName: string
): boolean {
  if (capabilities.probeFailed) return true
  return capabilities.tables.has(qualifiedName)
}

/**
 * Whether an app-owned table (`clickhouse_monitoring_*`, `monitoring_events`,
 * `monitoring_findings`) exists on this host.
 *
 * Those tables are absent by design on a read-only monitoring user or a
 * deployment with no metadata database, so a read of one has to be skippable
 * rather than an error. Identical to {@link hasTable} today — it exists as a
 * named seam so app-table callers read as intent, and so app-table policy has
 * one place to change if the two ever diverge.
 */
export function hasAppTable(
  capabilities: HostCapabilities,
  qualifiedName: string
): boolean {
  return hasTable(capabilities, qualifiedName)
}

/**
 * Set of `database.table` names, or `null` when the probe failed.
 *
 * The `null` shape is what `AlertRuleDef.tableCheck` gating already expects
 * (`shouldRunRule` runs every rule when the set is unknown), which is why this
 * returns `null` rather than an empty set.
 */
export async function getExistingTables(
  hostId: number
): Promise<Set<string> | null> {
  const capabilities = await getHostCapabilities(hostId)
  return capabilities.probeFailed ? null : new Set(capabilities.tables)
}

/** Cache counters, for the health diagnostics surface and for tests. */
export function getCapabilityCacheStats(): {
  hosts: number
  probes: number
  cacheHits: number
  probeFailures: number
} {
  return { hosts: cache.size, ...stats }
}
