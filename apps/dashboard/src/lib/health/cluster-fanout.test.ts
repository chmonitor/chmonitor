/**
 * Cluster fan-out tests (issue #3682).
 *
 * The issue's measured symptom is one query shape failing 163 times a day:
 *
 *   SELECT COUNT() FROM clusterAllReplicas(<cluster>, system.replicas)
 *   WHERE is_readonly = 1   →  516 Authentication failed
 *
 * Every counting test below states the unfixed behaviour it fails against. The
 * three that matter most:
 *
 *  - "a failing clusterAllReplicas is not retried inside the TTL" fails if the
 *    backoff is removed — the exact 163/day retry.
 *  - "one probe, not one per cluster name" fails if `selectCluster` fans out
 *    over every name — the 3× multiplier the issue measured.
 *  - "a fix at 09:00 is noticed" fails if the failure is sticky forever, which
 *    is the tempting fix and the wrong one.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

interface FetchArgs {
  query: string
  hostId?: number
  query_params?: Record<string, unknown>
}

const fetchCalls: FetchArgs[] = []
let clusterNames: string[] = ['all-replicated', 'default', 'all-clusters']
let fanoutError: { type: string; message: string } | null = null

/**
 * The issue's real error, verbatim in shape. ClickHouse 26.7 emits
 * `Code: 516. DB::Exception: default: Authentication failed: …` for an
 * inter-server password mismatch; `fetchData` flattens it to a
 * `FetchDataError` whose `type` is `query_error`, which is why the
 * classification cannot rely on the type.
 */
const AUTH_FAILURE = {
  type: 'query_error',
  message:
    'Code: 516. DB::Exception: default: Authentication failed: password is incorrect, or there is no user with such name (host: node-1)',
}

mock.module('@chm/clickhouse-client', () => ({
  fetchData: async (args: FetchArgs) => {
    fetchCalls.push(args)
    if (args.query.includes('system.clusters')) {
      return {
        data: clusterNames.map((cluster) => ({
          kind: 'cluster',
          name: cluster,
        })),
        metadata: {},
        error: undefined,
      }
    }
    if (args.query.includes('clusterAllReplicas')) {
      if (fanoutError) {
        return { data: null, metadata: {}, error: fanoutError }
      }
      return { data: [{ replica_count: '2' }], metadata: {}, error: undefined }
    }
    // The capability probe.
    return {
      data: [
        { kind: 'table', name: 'system.parts' },
        { kind: 'table', name: 'system.replicas' },
        ...clusterNames.map((cluster) => ({ kind: 'cluster', name: cluster })),
      ],
      metadata: {},
      error: undefined,
    }
  },
}))

const {
  AUTH_FAILURE_MESSAGE,
  CLUSTER_AUTH_BACKOFF_MAX_MS,
  CLUSTER_AUTH_BACKOFF_START_MS,
  clusterViewNotice,
  getClusterFanout,
  isInterServerAuthFailure,
  probeClusterFanout,
  resetClusterFanout,
  selectCluster,
  setClusterFanoutClock,
} = await import('./cluster-fanout')
const { resetHostCapabilities, setCapabilityCacheClock } = await import(
  './capability-cache'
)

let fakeNow = 1_000_000
const clock = () => fakeNow

/** Queries that actually fanned out, i.e. the ones the issue counts. */
function fanoutCalls(): FetchArgs[] {
  return fetchCalls.filter((c) => c.query.includes('clusterAllReplicas'))
}

beforeEach(() => {
  fetchCalls.length = 0
  clusterNames = ['all-replicated', 'default', 'all-clusters']
  fanoutError = null
  fakeNow = 1_000_000
  setCapabilityCacheClock(clock)
  setClusterFanoutClock(clock)
})

afterEach(() => {
  setCapabilityCacheClock(null)
  setClusterFanoutClock(null)
  resetHostCapabilities()
  resetClusterFanout()
})

describe('isInterServerAuthFailure', () => {
  test('recognises ClickHouse code 516', () => {
    expect(isInterServerAuthFailure({ code: 516, message: 'whatever' })).toBe(
      true
    )
  })

  test('recognises the message even when the code is lost', () => {
    // The layer that actually delivers the error to this module flattens it to
    // a message. Classifying on `type` alone would miss every one of these.
    expect(isInterServerAuthFailure(AUTH_FAILURE)).toBe(true)
  })

  test('does not treat an ordinary query error as auth failure', () => {
    // Guards the backoff: a typo'd column must not earn a 6-hour penalty.
    expect(
      isInterServerAuthFailure({
        type: 'query_error',
        message: "Code: 47. Missing columns: 'nope'",
      })
    ).toBe(false)
  })

  test('a network blip is not an auth failure', () => {
    expect(
      isInterServerAuthFailure({
        type: 'network_error',
        message: 'ECONNREFUSED',
      })
    ).toBe(false)
  })
})

describe('cluster selection happens once', () => {
  test('probes one cluster, not all three', async () => {
    // Fails against the unfixed route, which mapped over every cluster name:
    // 3 clusterAllReplicas calls where 1 suffices. The issue measured this
    // route at 163/day.
    const capability = await getClusterFanout(0)
    expect(capability.status).toBe('supported')
    expect(fanoutCalls()).toHaveLength(1)
    expect(fanoutCalls()[0].query_params).toEqual({ cluster: 'all-clusters' })
  })

  test('the chosen cluster is deterministic (first sorted name)', async () => {
    // Sorted, so two ticks in a row and two Worker isolates all pick the same
    // one. `all-clusters` sorts first — and on the reporting deployment it is
    // also the one that worked, so the alphabetical pick lands correctly there
    // without being tuned to it.
    const capability = await getClusterFanout(0)
    expect(capability.cluster).toBe('all-clusters')
  })

  test('a server with 12 clusters still spends one probe', async () => {
    clusterNames = Array.from({ length: 12 }, (_, i) => `cluster-${i}`)
    await getClusterFanout(0)
    expect(fanoutCalls()).toHaveLength(1)
  })

  test('a server with no clusters never issues a fan-out query', async () => {
    clusterNames = []
    const capability = await getClusterFanout(0)
    expect(capability.status).toBe('no_clusters')
    expect(fanoutCalls()).toHaveLength(0)
  })
})

describe('a failing clusterAllReplicas is not retried inside the TTL', () => {
  test('the query count does not grow per tick', async () => {
    // The headline criterion, stated over the span the notifications route
    // actually polls (every 30s). 60 polls = 30 minutes of wall clock. The
    // unfixed route sent 60 failing `clusterAllReplicas` queries in that
    // window; the backoff ladder allows one at t=0 and one when the first
    // 10-minute window lapses, so 2 — a 60x cut, and crucially NOT one per
    // tick.
    fanoutError = AUTH_FAILURE
    await getClusterFanout(0)
    for (let tick = 0; tick < 60; tick++) {
      await getClusterFanout(0)
      fakeNow += 30 * 1000
    }
    expect(fanoutCalls()).toHaveLength(2)
    // The precise claim: bounded by the backoff windows, never by tick count.
    expect(fanoutCalls().length).toBeLessThan(60 / 10)
  })

  test('nothing is retried within the first backoff window', async () => {
    fanoutError = AUTH_FAILURE
    const first = await getClusterFanout(0)
    expect(first.status).toBe('auth_failed')
    expect(first.backoffMs).toBe(CLUSTER_AUTH_BACKOFF_START_MS)
    // Just inside the window.
    fakeNow += CLUSTER_AUTH_BACKOFF_START_MS - 1
    expect(fanoutCalls()).toHaveLength(1)
    // And at the boundary it is allowed to try again.
    fakeNow += 1
    await getClusterFanout(0)
    expect(fanoutCalls()).toHaveLength(2)
  })

  test('a day of 30-second polls costs 9 queries, not 2880', async () => {
    // 2880 = the issue's poll rate. With the doubling ladder capped at 6h the
    // day costs ~8-9 probes. This is the ≥90% cut the issue was asking for on
    // this query specifically.
    fanoutError = AUTH_FAILURE
    for (let tick = 0; tick < 2880; tick++) {
      await getClusterFanout(0)
      fakeNow += 30 * 1000
    }
    expect(fanoutCalls().length).toBeLessThanOrEqual(10)
    expect(fanoutCalls().length).toBeGreaterThan(0)
  })

  test('concurrent readers share one probe', async () => {
    fanoutError = AUTH_FAILURE
    await Promise.all(Array.from({ length: 10 }, () => getClusterFanout(0)))
    expect(fanoutCalls()).toHaveLength(1)
  })

  test('each host keeps its own answer', async () => {
    fanoutError = AUTH_FAILURE
    await getClusterFanout(0)
    await getClusterFanout(1)
    expect(fanoutCalls()).toHaveLength(2)
  })
})

describe('the backoff ladder', () => {
  test('doubles on each consecutive auth failure and stops at the ceiling', async () => {
    fanoutError = AUTH_FAILURE
    const seen: number[] = []
    for (let attempt = 0; attempt < 8; attempt++) {
      const capability = await getClusterFanout(0)
      seen.push(capability.backoffMs)
      // Jump past whatever window we were given.
      fakeNow = capability.nextProbeAt
    }
    // 10m → 20m → 40m → 80m → 160m → 320m, then 640m would exceed the 6h
    // ceiling and is clamped. Eight consecutive failures, so the ladder has to
    // be flat at the end rather than still climbing.
    expect(seen).toEqual([
      CLUSTER_AUTH_BACKOFF_START_MS,
      CLUSTER_AUTH_BACKOFF_START_MS * 2,
      CLUSTER_AUTH_BACKOFF_START_MS * 4,
      CLUSTER_AUTH_BACKOFF_START_MS * 8,
      CLUSTER_AUTH_BACKOFF_START_MS * 16,
      CLUSTER_AUTH_BACKOFF_START_MS * 32,
      CLUSTER_AUTH_BACKOFF_MAX_MS,
      CLUSTER_AUTH_BACKOFF_MAX_MS,
    ])
  })

  test('a non-auth failure re-probes on the plain TTL, with no escalation', async () => {
    // Guards the deliberate asymmetry: a network blip must not earn the same
    // 6-hour penalty as a rejected password.
    fanoutError = { type: 'network_error', message: 'ECONNREFUSED' }
    const first = await getClusterFanout(0)
    expect(first.status).toBe('unavailable')
    expect(first.backoffMs).toBe(0)
    fakeNow = first.nextProbeAt
    fanoutError = AUTH_FAILURE
    const second = await getClusterFanout(0)
    // Starting fresh, not inheriting an escalation from the blip.
    expect(second.backoffMs).toBe(CLUSTER_AUTH_BACKOFF_START_MS)
  })
})

describe('a fix is noticed — the failure is not sticky forever', () => {
  test('an operator fixing inter-server auth is picked up within one window', async () => {
    // The reason this is backoff rather than "sticky for the process". A sticky
    // failure would need a redeploy; this recovers on its own.
    fanoutError = AUTH_FAILURE
    let capability = await getClusterFanout(0)
    expect(capability.status).toBe('auth_failed')

    // Operator fixes `<remote_servers><password>` at 09:00.
    fanoutError = null
    fakeNow = capability.nextProbeAt
    capability = await getClusterFanout(0)
    expect(capability.status).toBe('supported')
    expect(clusterViewNotice(capability)).toBeNull()
  })

  test('a recovered cluster resets the ladder so a later regression retries promptly', async () => {
    // Otherwise a server that failed twice in the morning would wait 6 hours
    // for its next regression to be seen.
    fanoutError = AUTH_FAILURE
    let capability = await getClusterFanout(0)
    fakeNow = capability.nextProbeAt
    fanoutError = null
    capability = await getClusterFanout(0)
    expect(capability.status).toBe('supported')

    fakeNow += 1
    fanoutError = AUTH_FAILURE
    capability = await getClusterFanout(0)
    expect(capability.backoffMs).toBe(CLUSTER_AUTH_BACKOFF_START_MS)
  })

  test('a supported cluster is re-probed after the TTL, not remembered forever', async () => {
    await getClusterFanout(0)
    expect(fanoutCalls()).toHaveLength(1)
    // `supported` has no backoff, so the next probe is a plain TTL away.
    fakeNow += 10 * 60 * 1000 + 1
    await getClusterFanout(0)
    expect(fanoutCalls()).toHaveLength(2)
  })
})

describe('the UI notice', () => {
  test('an auth failure says exactly what the issue asked for', async () => {
    // "Surface 'cluster-wide view unavailable: inter-server auth' once in the
    // UI rather than silently degrading."
    fanoutError = AUTH_FAILURE
    const capability = await getClusterFanout(0)
    const notice = clusterViewNotice(capability)
    expect(notice).toBe(AUTH_FAILURE_MESSAGE)
    expect(notice).toContain('Cluster-wide view unavailable')
    expect(notice).toContain('inter-server auth')
    // It names the cluster it tried, so the operator knows which
    // `<remote_servers>` block to fix.
    expect(capability.cluster).toBe('all-clusters')
  })

  test('a healthy cluster produces no notice', async () => {
    expect(clusterViewNotice(await getClusterFanout(0))).toBeNull()
  })

  test('no clusters is not a degradation worth a banner', async () => {
    // A standalone server with no cluster definitions is normal, not broken.
    clusterNames = []
    const capability = await getClusterFanout(0)
    expect(capability.status).toBe('no_clusters')
    expect(clusterViewNotice(capability)).toBeNull()
  })

  test('a failed capability probe says "unknown", not "no clusters"', async () => {
    // Lying about the server's shape is worse than saying nothing.
    clusterNames = []
    const capability = await getClusterFanout(0)
    expect(capability.status).toBe('no_clusters')
    expect(capability.message).toContain('system.clusters')
  })
})

describe('probeClusterFanout never throws', () => {
  test('an auth error is classified, not propagated', async () => {
    fanoutError = AUTH_FAILURE
    expect(await probeClusterFanout(0, 'default')).toEqual({
      ok: false,
      authFailure: true,
    })
  })

  test('a non-auth error is classified as such', async () => {
    fanoutError = { type: 'timeout_error', message: 'Timeout exceeded' }
    expect(await probeClusterFanout(0, 'default')).toEqual({
      ok: false,
      authFailure: false,
    })
  })

  test('a success is ok', async () => {
    expect(await probeClusterFanout(0, 'default')).toEqual({ ok: true })
  })
})

describe('selectCluster', () => {
  test('is null when the capability probe failed', () => {
    expect(
      selectCluster({
        tables: new Set<string>(),
        clusters: ['a'],
        probeFailed: true,
        probedAt: 0,
      })
    ).toBeNull()
  })

  test('is null on an empty cluster list', () => {
    expect(
      selectCluster({
        tables: new Set<string>(),
        clusters: [],
        probeFailed: false,
        probedAt: 0,
      })
    ).toBeNull()
  })
})
