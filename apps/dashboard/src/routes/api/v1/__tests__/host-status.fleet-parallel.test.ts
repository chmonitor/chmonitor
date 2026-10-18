/**
 * GET /api/v1/host-status?fleet=1 runs the core probe plus four Fleet blocks
 * against ClickHouse. They are independent, so they must run concurrently:
 * the Fleet page polls this route once per host, and five sequential
 * round-trips made each row wait 5x the ClickHouse latency. This also pins
 * the per-block guard: one failing block must not drop the others.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
    CHM_CLOUD_MODE: 'false',
  },
}))

let inFlight = 0
let maxInFlight = 0
let failingTable: string | null = null
const queries: string[] = []

function rowsFor(query: string): Record<string, unknown>[] {
  if (query.includes('hostName()'))
    return [{ version: '24.1', uptime: '1 day', hostname: 'h' }]
  if (query.includes('system.databases'))
    return [{ databases: 2, tables: 10, clusterNodes: 1 }]
  if (query.includes('system.disks')) return [{ runningQueries: 3 }]
  if (query.includes('system.replicas'))
    return [{ replicaCount: 1, readonlyReplicas: 0, replicationDelay: 4 }]
  if (query.includes('system.metric_log')) return [{ value: 1 }, { value: 2 }]
  return []
}

mock.module('@chm/clickhouse-client', () => ({
  getClient: async () => ({
    query: async ({ query }: { query: string }) => {
      queries.push(query)
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 20))
      inFlight--
      if (failingTable && query.includes(failingTable)) {
        throw new Error(`no grant on ${failingTable}`)
      }
      return { json: async () => rowsFor(query) }
    },
  }),
}))

type GetHandler = (ctx: { request: Request }) => Promise<Response>
const { Route } = await import('../host-status')
const handler = (
  Route.options.server as unknown as { handlers: { GET: GetHandler } }
).handlers.GET

async function getFleet() {
  const res = await handler({
    request: new Request('http://x/api/v1/host-status?hostId=0&fleet=1'),
  })
  const body = (await res.json()) as {
    success: boolean
    data: Record<string, unknown>
  }
  return { status: res.status, body }
}

beforeEach(() => {
  inFlight = 0
  maxInFlight = 0
  failingTable = null
  queries.length = 0
})

// Runs the route's real counts SQL in `clickhouse local`, with
// `system.clusters` swapped for a fixture table when rows are given.
const CH = Bun.which('clickhouse')
function runCountsLocally(
  query: string,
  clusters: [string, string, number][] | null
): Record<string, unknown> {
  let sql = query
  if (clusters) {
    const values = clusters
      .map(([c, h, l]) => `('${c}', '${h}', ${l})`)
      .join(', ')
    sql = `CREATE TABLE fx (cluster String, host_name String, is_local UInt8) ENGINE = Memory;
INSERT INTO fx VALUES ${values};
${query.replaceAll('system.clusters', 'fx')} FORMAT JSONEachRow`
  } else sql = `${query} FORMAT JSONEachRow`
  const out = Bun.spawnSync([CH as string, 'local', '--multiquery', '-q', sql])
  if (out.exitCode !== 0) throw new Error(out.stderr.toString())
  return JSON.parse(out.stdout.toString().trim())
}

async function clusterNodesFor(clusters: [string, string, number][] | null) {
  await getFleet()
  const counts = queries.find((q) => q.includes('AS clusterNodes'))
  return Number(runCountsLocally(counts as string, clusters).clusterNodes)
}

describe.skipIf(!CH)('clusterNodes (#3893), run in clickhouse local', () => {
  test('counts hosts only from clusters this node belongs to', async () => {
    // A node in `main` that also defines a foreign `a_test_other`: the
    // unscoped count was 3, the right answer is 2.
    expect(
      await clusterNodesFor([
        ['main', 'self', 1],
        ['main', 'peer', 0],
        ['a_test_other', 'stranger', 0],
      ])
    ).toBe(2)
  })

  test('falls back to every cluster when no row is is_local', async () => {
    // Hostname mismatch in a container: is_local is 0 everywhere. Counting
    // local clusters only would report 0 nodes.
    expect(
      await clusterNodesFor([
        ['main', 'self', 0],
        ['main', 'peer', 0],
        ['other', 'stranger', 0],
      ])
    ).toBe(3)
  })

  test('no clusters at all stays 0, as before', async () => {
    expect(await clusterNodesFor(null)).toBe(0)
  })
})

describe('GET /api/v1/host-status?fleet=1 — concurrent Fleet blocks', () => {
  test('core probe and all four Fleet queries are in flight together', async () => {
    const { status, body } = await getFleet()

    expect(status).toBe(200)
    expect(maxInFlight).toBe(5)
    expect(body.data).toMatchObject({
      version: '24.1',
      databases: 2,
      runningQueries: 3,
      replicationDelay: 4,
      series: [1, 2],
    })
  })

  test('one failing Fleet block does not drop the others', async () => {
    failingTable = 'system.replicas'

    const { status, body } = await getFleet()

    expect(status).toBe(200)
    expect(body.data.databases).toBe(2)
    expect(body.data.series).toEqual([1, 2])
    expect(body.data.replicationDelay).toBeUndefined()
  })

  test('a failing core probe still fails the request', async () => {
    failingTable = 'hostName()'

    const { status, body } = await getFleet()

    expect(status).toBeGreaterThanOrEqual(500)
    expect(body.success).toBe(false)
  })
})
