/**
 * Capability-cache tests (issue #3682).
 *
 * The issue's acceptance criterion is quantitative — "a `tableCheck` probe runs
 * at most once per TTL per host" — so every test here asserts a CALL COUNT, not
 * that a cache object exists. A test that only checks "the cache is defined"
 * passes against the code it is meant to catch, which is precisely how the
 * 163-queries-a-day retry shipped.
 *
 * Each counting test states which unfixed behaviour it fails against, in the
 * test name or the comment above it.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

interface FetchArgs {
  query: string
  hostId?: number
  query_params?: Record<string, unknown>
}

const fetchCalls: FetchArgs[] = []
let probeRows: Array<{ kind: string; name: string }> = []
let probeError: { type: string; message: string } | null = null

mock.module('@chm/clickhouse-client', () => ({
  fetchData: async (args: FetchArgs) => {
    fetchCalls.push(args)
    if (probeError) {
      return { data: null, metadata: {}, error: probeError }
    }
    return { data: probeRows, metadata: {}, error: undefined }
  },
}))

const {
  buildCapabilityProbeSql,
  CAPABILITY_TTL_MS,
  getExistingTables,
  getHostCapabilities,
  hasAppTable,
  hasTable,
  resetHostCapabilities,
  setCapabilityCacheClock,
} = await import('./capability-cache')

/** Rows a healthy 26.7 fixture returns: system tables + two clusters. */
function healthyRows(): Array<{ kind: string; name: string }> {
  return [
    { kind: 'table', name: 'system.parts' },
    { kind: 'table', name: 'system.disks' },
    { kind: 'table', name: 'system.backup_log' },
    { kind: 'table', name: 'system.monitoring_findings' },
    { kind: 'cluster', name: 'all-replicated' },
    { kind: 'cluster', name: 'default' },
    { kind: 'cluster', name: 'all-clusters' },
  ]
}

let fakeNow = 1_000_000
const clock = () => fakeNow

beforeEach(() => {
  fetchCalls.length = 0
  probeRows = healthyRows()
  probeError = null
  fakeNow = 1_000_000
  setCapabilityCacheClock(clock)
})

afterEach(() => {
  setCapabilityCacheClock(null)
  resetHostCapabilities()
})

describe('the probe statement', () => {
  test('asks for system tables, app tables and clusters in one statement', () => {
    const sql = buildCapabilityProbeSql('system')
    expect(sql).toContain('system.tables')
    expect(sql).toContain('system.clusters')
    expect(sql).toContain("database IN ('system', {appDatabase: String})")
    // One statement, not two: the two halves are UNION ALL-ed.
    expect(sql).toContain('UNION ALL')
    expect(sql.match(/SELECT DISTINCT/g)).toHaveLength(1)
  })

  test('scopes the catalog scan to local database engines (#3686)', () => {
    // A `system.tables` scan that is not pinned to `system` must carry the
    // engine allow-list, or the probe itself becomes the expensive background
    // query this issue is about.
    expect(buildCapabilityProbeSql('system')).toContain(
      'system.databases WHERE engine IN'
    )
  })

  test('the app database is a parameter, not interpolated', () => {
    expect(buildCapabilityProbeSql('chmonitor_meta')).toContain(
      '{appDatabase: String}'
    )
  })
})

describe('probe frequency — the "once per TTL per host" criterion', () => {
  test('50 reads within the TTL cost 1 query', async () => {
    // Fails against the unfixed behaviour: 50 reads → 50 probes. This is the
    // issue's 290/day `tableCheck` row, scaled to a single tick.
    for (let i = 0; i < 50; i++) {
      await getExistingTables(0)
    }
    expect(fetchCalls).toHaveLength(1)
  })

  test('the count does not grow per tick while the TTL holds', async () => {
    // The daily reality: the sweep runs every 5 minutes, so a 10-minute TTL
    // covers consecutive ticks. Before the cache each of those ticks sent its
    // own `system.tables` probe — that is the 290/day `tableCheck` row and the
    // per-tick `SELECT concat(database,'.',name)` in `run-host.ts`.
    await getExistingTables(0)
    fakeNow += 4 * 60 * 1000
    await getExistingTables(0)
    fakeNow += 4 * 60 * 1000
    await getExistingTables(0)
    expect(fetchCalls).toHaveLength(1)
  })

  test('the TTL boundary itself re-probes rather than serving an expired entry', async () => {
    // `expiresAt > now`, so an entry read at exactly TTL age is stale. Being
    // off-by-one-strict here is the safe direction: serving one tick of stale
    // capability data is harmless, serving a permanently-fresh one is not.
    await getExistingTables(0)
    fakeNow += CAPABILITY_TTL_MS
    await getExistingTables(0)
    expect(fetchCalls).toHaveLength(2)
  })

  test('a full day of 5-minute ticks probes ~144 times, not 288', async () => {
    // 288 ticks/day is one probe per tick — the unfixed rate. With a 10-minute
    // TTL it is ~144, and each of those 144 is ONE statement answering tables
    // AND app tables AND clusters, replacing three separate probes per tick.
    for (let tick = 0; tick < 288; tick++) {
      await getExistingTables(0)
      fakeNow += 5 * 60 * 1000
    }
    expect(fetchCalls.length).toBeLessThanOrEqual(145)
  })

  test('the probe repeats once the TTL lapses', async () => {
    // Guards against the opposite failure: a cache with no expiry, which would
    // never notice `system.backup_log` being enabled at 09:00.
    await getExistingTables(0)
    fakeNow += CAPABILITY_TTL_MS + 1
    await getExistingTables(0)
    expect(fetchCalls).toHaveLength(2)
  })

  test('each host is probed independently', async () => {
    // A 2-node cluster must not let host 0's answer answer for host 1 — that
    // would report host 1's tables using host 0's snapshot.
    await getExistingTables(0)
    await getExistingTables(1)
    expect(fetchCalls).toHaveLength(2)
    expect(fetchCalls.map((c) => c.hostId)).toEqual([0, 1])
  })

  test('concurrent readers share one probe', async () => {
    // A fresh isolate mounting /health asks for a dozen capabilities at once.
    await Promise.all(Array.from({ length: 12 }, () => getExistingTables(0)))
    expect(fetchCalls).toHaveLength(1)
  })
})

describe('hasTable / hasAppTable', () => {
  test('a table the probe saw answers true', async () => {
    const caps = await getHostCapabilities(0)
    expect(hasTable(caps, 'system.parts')).toBe(true)
    expect(hasTable(caps, 'system.nope')).toBe(false)
  })

  test('a missing app table answers false so the read is skipped', async () => {
    // #3682 bullet 3: `clickhouse_monitoring_*` tables are absent on a
    // read-only user or a deployment with no metadata DB. Without this the
    // route errored on every poll instead of returning an empty result.
    probeRows = healthyRows().filter(
      (r) => r.name !== 'system.monitoring_findings'
    )
    const caps = await getHostCapabilities(0)
    expect(hasAppTable(caps, 'system.monitoring_findings')).toBe(false)
    expect(hasTable(caps, 'system.parts')).toBe(true)
  })

  test('app tables resolve in the app database, not just `system`', async () => {
    // The probe asks for `system` AND `APP_DATABASE`, so a deployment with a
    // custom CLICKHOUSE_DATABASE is covered too.
    probeRows = [
      { kind: 'table', name: 'system.parts' },
      { kind: 'table', name: 'chmonitor.monitoring_findings' },
    ]
    const caps = await getHostCapabilities(0)
    expect(hasAppTable(caps, 'chmonitor.monitoring_findings')).toBe(true)
  })

  test('an unknown answer (failed probe) reads as present, not missing', async () => {
    // Fails against a fail-closed cache, which would disable every optional
    // health check because of one network blip.
    probeError = { type: 'network_error', message: 'connection reset' }
    const caps = await getHostCapabilities(0)
    expect(caps.probeFailed).toBe(true)
    expect(hasTable(caps, 'system.backup_log')).toBe(true)
    expect(hasAppTable(caps, 'system.monitoring_findings')).toBe(true)
  })

  test('a failed probe yields null from getExistingTables, not an empty set', async () => {
    // The `null` shape is what `tableCheck` gating reads as "run everything";
    // an empty set would mean "skip everything".
    probeError = { type: 'network_error', message: 'connection reset' }
    expect(await getExistingTables(0)).toBeNull()
  })
})

describe('the cluster half of the snapshot', () => {
  test('cluster names are collected and sorted', async () => {
    const caps = await getHostCapabilities(0)
    expect(caps.clusters).toEqual(['all-clusters', 'all-replicated', 'default'])
  })

  test('a failed probe reports no clusters rather than an empty guess', async () => {
    probeError = { type: 'query_error', message: 'boom' }
    const caps = await getHostCapabilities(0)
    expect(caps.clusters).toEqual([])
    expect(caps.probeFailed).toBe(true)
  })
})

describe('a stale snapshot is replaced, not merged', () => {
  test('the next probe after the TTL reflects newly created tables', async () => {
    await getExistingTables(0)
    probeRows = [...probeRows, { kind: 'table', name: 'system.view_refreshes' }]
    fakeNow += CAPABILITY_TTL_MS + 1
    const caps = await getHostCapabilities(0)
    expect(hasTable(caps, 'system.view_refreshes')).toBe(true)
    expect(fetchCalls).toHaveLength(2)
  })
})
