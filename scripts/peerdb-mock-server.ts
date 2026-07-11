#!/usr/bin/env bun
/**
 * Mock PeerDB flow-api for local UI testing.
 *
 * Implements the read-only subset of PeerDB's REST surface (grpc-gateway,
 * `protos/route.proto`) that CHM's PeerDB monitor consumes, with a fixture set
 * mirroring the CHM Redesign mock (7 mirrors across Postgres/MySQL/Mongo →
 * ClickHouse/Kafka/S3). JSON is lowerCamelCase to match grpc-gateway output and
 * the client types in `lib/peerdb/types.ts`.
 *
 * Usage:
 *   bun scripts/peerdb-mock-server.ts            # listens on :8113
 *   PEERDB_API_URL=http://localhost:8113 bun run dev
 *
 * This is a TEST DOUBLE — it does not validate auth and returns static data.
 */

const PORT = Number(process.env.PORT ?? 8113)

const PEERS = [
  { name: 'pg-prod', type: 'POSTGRES', role: 'source' },
  { name: 'pg-staging', type: 'POSTGRES', role: 'source' },
  { name: 'mysql-shop', type: 'MYSQL', role: 'source' },
  { name: 'mongo-catalog', type: 'MONGO', role: 'source' },
  { name: 'ch-analytics', type: 'CLICKHOUSE', role: 'destination' },
  { name: 'ch-archive', type: 'CLICKHOUSE', role: 'destination' },
  { name: 'kafka-events', type: 'KAFKA', role: 'destination' },
  { name: 's3-datalake', type: 'S3', role: 'destination' },
] as const

interface MirrorFixture {
  name: string
  isCdc: boolean
  source: string
  sourceType: string
  destination: string
  destinationType: string
  status: string
  createdAgoHours: number
  rowsSynced: number
  rowsPerSec: number
  lagSec: number | null
  tables: string[]
  workflowId: string
  errorMessage?: string
}

const HOUR = 3_600_000

const MIRRORS: MirrorFixture[] = [
  {
    name: 'orders_cdc',
    isCdc: true,
    source: 'pg-prod',
    sourceType: 'POSTGRES',
    destination: 'ch-analytics',
    destinationType: 'CLICKHOUSE',
    status: 'STATUS_RUNNING',
    createdAgoHours: 128,
    rowsSynced: 18_412_603,
    rowsPerSec: 2840,
    lagSec: 3.2,
    tables: ['public.orders', 'public.order_items', 'public.shipments'],
    workflowId: 'pg-pgmirror_orders_cdc-d2c8',
  },
  {
    name: 'users_cdc',
    isCdc: true,
    source: 'pg-prod',
    sourceType: 'POSTGRES',
    destination: 'ch-analytics',
    destinationType: 'CLICKHOUSE',
    status: 'STATUS_RUNNING',
    createdAgoHours: 290,
    rowsSynced: 4_204_881,
    rowsPerSec: 412,
    lagSec: 1.1,
    tables: ['public.users', 'public.user_profiles', 'public.sessions'],
    workflowId: 'pg-pgmirror_users_cdc-ab19',
  },
  {
    name: 'payments_cdc',
    isCdc: true,
    source: 'pg-staging',
    sourceType: 'POSTGRES',
    destination: 'ch-analytics',
    destinationType: 'CLICKHOUSE',
    status: 'STATUS_RUNNING',
    createdAgoHours: 59,
    rowsSynced: 9_124_010,
    rowsPerSec: 1120,
    lagSec: 8.4,
    tables: ['payments.charges', 'payments.refunds', 'payments.disputes'],
    workflowId: 'pg-pgmirror_payments_cdc-7e44',
  },
  {
    name: 'inventory_cdc',
    isCdc: true,
    source: 'mysql-shop',
    sourceType: 'MYSQL',
    destination: 'kafka-events',
    destinationType: 'KAFKA',
    status: 'STATUS_RUNNING',
    createdAgoHours: 508,
    rowsSynced: 12_408_220,
    rowsPerSec: 980,
    lagSec: 2.2,
    tables: ['shop.products', 'shop.stock_levels', 'shop.warehouses'],
    workflowId: 'mysql-mirror_inventory-1f9c',
  },
  {
    name: 'events_snapshot',
    isCdc: false,
    source: 'pg-prod',
    sourceType: 'POSTGRES',
    destination: 's3-datalake',
    destinationType: 'S3',
    status: 'STATUS_SNAPSHOT',
    createdAgoHours: 4,
    rowsSynced: 280_412_000,
    rowsPerSec: 41_200,
    lagSec: null,
    tables: ['analytics.events_partitioned'],
    workflowId: 'qrep-events_snapshot-90af',
  },
  {
    name: 'catalog_sync',
    isCdc: true,
    source: 'mongo-catalog',
    sourceType: 'MONGO',
    destination: 'ch-analytics',
    destinationType: 'CLICKHOUSE',
    status: 'STATUS_PAUSED',
    createdAgoHours: 918,
    rowsSynced: 884_120,
    rowsPerSec: 0,
    lagSec: 7_280,
    tables: ['catalog.products', 'catalog.categories'],
    workflowId: 'mongo-mirror_catalog-5d2a',
  },
  {
    name: 'legacy_archive',
    isCdc: true,
    source: 'pg-staging',
    sourceType: 'POSTGRES',
    destination: 'ch-archive',
    destinationType: 'CLICKHOUSE',
    status: 'STATUS_FAILED',
    createdAgoHours: 1489,
    rowsSynced: 38_204_109,
    rowsPerSec: 0,
    lagSec: 84_120,
    tables: ['legacy.audit_log', 'legacy.events_v1'],
    workflowId: 'pg-pgmirror_legacy-c01b',
    errorMessage:
      "replication slot 'pgmirror_slot_legacy' is approaching max_wal_size (98.4% · 4180 MiB) — destination consumer is not draining; check ch-archive ingestion rate",
  },
]

function mirror(name: string): MirrorFixture | undefined {
  return MIRRORS.find((m) => m.name === name)
}

function seeded(n: number): number {
  const x = Math.sin(n * 99.137) * 43758.5453
  return x - Math.floor(x)
}

function seedFromName(name: string): number {
  return name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
}

/** Per-minute rows trend (24 points), last bucket ≈ rowsPerSec * 60. */
function graphData(m: MirrorFixture) {
  const now = Date.now()
  const base = m.rowsPerSec * 60
  const variance = base * 0.35
  const s = seedFromName(m.name)
  const data: { time: string; rows: number }[] = []
  let total = 0
  for (let i = 23; i >= 0; i--) {
    let rows: number
    if (m.status === 'STATUS_PAUSED') rows = i > 5 ? Math.max(0, base) : 0
    else if (m.status === 'STATUS_FAILED')
      rows = i > 10 ? Math.max(0, base * 2.4) : 0
    else if (m.status === 'STATUS_SNAPSHOT')
      rows = Math.max(
        0,
        base * (0.5 + (23 - i) / 30) + (seeded(s + i) - 0.5) * variance
      )
    else
      rows = Math.max(
        0,
        base +
          Math.sin(i * 0.45) * variance * 0.6 +
          (seeded(s + i) - 0.5) * variance
      )
    rows = Math.round(rows)
    total += rows
    data.push({ time: new Date(now - i * 60_000).toISOString(), rows })
  }
  return { data, totalRows: total }
}

function cdcBatches(m: MirrorFixture) {
  const now = Date.now()
  // Last batch ends `lagSec` ago so the UI derives the design lag value.
  const lastEnd = m.lagSec != null ? now - m.lagSec * 1000 : now - 30_000
  const out = Array.from({ length: 12 }, (_, i) => {
    const end = lastEnd - (11 - i) * 60_000
    const start = end - 8000
    const numRows = Math.round(
      m.rowsPerSec * 8 + seeded(seedFromName(m.name) + i) * 2000
    )
    return {
      batchId: 1000 + i,
      startLsn: `0/${(16_000_000 + i * 9000).toString(16).toUpperCase()}`,
      endLsn: `0/${(16_009_000 + i * 9000).toString(16).toUpperCase()}`,
      numRows,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
    }
  })
  return { cdcBatches: out, total: out.length, page: 0 }
}

function partitions(m: MirrorFixture) {
  const now = Date.now()
  const total = 45
  const doneN = 28
  const start0 = now - m.createdAgoHours * HOUR
  return Array.from({ length: total }, (_, i) => {
    const dur = Math.round(18_000 + seeded(i + 10) * 64_000)
    const start = start0 + i * (dur + 1200)
    const rows = Math.round(9_400_000 + seeded(i + 20) * 2_400_000)
    const done = i < doneN
    const inFlight = i >= doneN && i < doneN + 2
    return {
      partitionId: `0a${(0xb1c2d3e4 + i).toString(16).padStart(8, '0')}-${(0x4f50 + i).toString(16)}-9c2a-${(0x1100 + i).toString(16)}-${(0xa1b2c3d40000 + i).toString(16)}`,
      startTime: new Date(start).toISOString(),
      endTime: done ? new Date(start + dur).toISOString() : undefined,
      pullEndTime: done ? new Date(start + dur * 0.7).toISOString() : undefined,
      numRows: rows,
      rowsInPartition: rows,
      rowsSynced: done
        ? rows
        : inFlight
          ? Math.round(rows * (0.3 + seeded(i + 30) * 0.5))
          : 0,
      restartCount: 0,
    }
  })
}

/**
 * Per-table clone summaries for the snapshot / initial-load phase
 * (GET /v1/mirrors/cdc/initial_load/{flow}). Snapshotting mirrors report tables
 * mid-clone (partial partitions, fetch done but not consolidated); already
 * running/streaming mirrors report every table fully cloned.
 */
function initialLoad(m: MirrorFixture) {
  const now = Date.now()
  const snapshotting =
    m.status === 'STATUS_SNAPSHOT' || m.status === 'STATUS_SETUP'
  const tableSummaries = m.tables.map((tableName, i) => {
    const total = 8 + Math.round(seeded(i + 4) * 40)
    // Snapshotting: the first table is nearly done, later tables trail behind.
    const frac = snapshotting
      ? Math.max(0.05, Math.min(1, 1 - i * 0.28 - seeded(i + 5) * 0.15))
      : 1
    const completed = Math.min(total, Math.round(total * frac))
    const fetchCompleted = !snapshotting || frac > 0.5
    const consolidateCompleted = !snapshotting || completed >= total
    const rowsSynced = Math.round(
      (9_400_000 + seeded(i + 6) * 3_200_000) * frac
    )
    return {
      tableName,
      sourceTable: tableName,
      startTime: new Date(now - (m.tables.length - i) * 90_000).toISOString(),
      numPartitionsCompleted: completed,
      numPartitionsTotal: total,
      numRowsSynced: rowsSynced,
      avgTimePerPartitionMs: Math.round(1800 + seeded(i + 7) * 6400),
      fetchCompleted,
      consolidateCompleted,
    }
  })
  return { tableSummaries }
}

/** Authoritative cumulative rows synced (GET /v1/mirrors/total_rows_synced/{flow}). */
function totalRowsSynced(m: MirrorFixture) {
  return { totalCount: m.rowsSynced }
}

function tableCounts(m: MirrorFixture) {
  const tablesData = m.tables.map((tableName, i) => {
    const inserts = Math.round(5000 + seeded(i + 1) * 200000)
    const updates = Math.round(seeded(i + 2) * 80000)
    const deletes = Math.round(seeded(i + 3) * 12000)
    return {
      tableName,
      counts: {
        insertsCount: inserts,
        updatesCount: updates,
        deletesCount: deletes,
        totalCount: inserts + updates + deletes,
      },
    }
  })
  return { tablesData }
}

/**
 * Peer config + version per peer (GET /v1/peers/info/{name}).
 *
 * Secret-shaped fields (passwords, access keys) are intentionally omitted from
 * these fixtures — the real PeerDB API redacts them server-side, and including
 * even masked credential tuples here trips secret scanners.
 */
const PEER_INFO: Record<
  string,
  { config: Record<string, unknown>; version: string | null }
> = {
  'pg-prod': {
    config: {
      host: 'pg-prod.db.example.invalid',
      port: 5432,
      user: 'peerdb',
      database: 'shop_prod',
      sslMode: 'require',
    },
    version:
      'PostgreSQL 16.3 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 7.3.1 20180712, 64-bit',
  },
  'pg-staging': {
    config: {
      host: 'pg-staging.db.example.invalid',
      port: 5432,
      user: 'peerdb',
      database: 'shop_staging',
      sslMode: 'require',
    },
    version: 'PostgreSQL 15.6 on x86_64-pc-linux-gnu, 64-bit',
  },
  'mysql-shop': {
    config: {
      host: 'mysql.shop.example.invalid',
      port: 3306,
      user: 'peerdb_repl',
      database: 'shop',
    },
    version: null,
  },
  'mongo-catalog': {
    config: {
      uri: 'mongodb+srv://mongo.catalog.example.invalid/?replicaSet=rs0',
    },
    version: null,
  },
  'ch-analytics': {
    config: {
      host: 'ch-cluster.analytics.example.invalid',
      port: 9440,
      user: 'peerdb',
      database: 'analytics',
      s3Path: 's3://peerdb-ch-staging/analytics',
      region: 'us-east-1',
    },
    version: 'ClickHouse 24.8.4.13 (official build)',
  },
  'ch-archive': {
    config: {
      host: 'ch-archive.cold.example.invalid',
      port: 9440,
      user: 'peerdb',
      database: 'archive',
      s3Path: 's3://peerdb-ch-staging/archive',
      region: 'us-west-2',
    },
    version: 'ClickHouse 24.3.6.48 (official build)',
  },
  'kafka-events': {
    config: {
      servers: [
        'kafka-0.events.example.invalid:9092',
        'kafka-1.events.example.invalid:9092',
      ],
      username: 'peerdb',
      sasl: 'SCRAM-SHA-512',
    },
    version: null,
  },
  's3-datalake': {
    config: {
      url: 's3://prod-datalake',
      region: 'us-east-1',
      codec: 'parquet+snappy',
    },
    version: null,
  },
}

function peerInfo(name: string) {
  const peer = PEERS.find((p) => p.name === name)
  const info = PEER_INFO[name]
  if (!peer) return null
  return {
    peer: { name, type: peer.type, config: info?.config ?? {} },
    version: info?.version ?? undefined,
  }
}

/** Varied-level mirror logs (info heartbeats + warns + errors). */
function mirrorLogs(m: MirrorFixture) {
  const now = Date.now()
  const errors: {
    id: number
    flowName: string
    errorType: string
    errorMessage: string
    errorTimestamp: string
  }[] = []
  let id = 700_000 + seedFromName(m.name)
  const push = (errorType: string, errorMessage: string, minsAgo: number) =>
    errors.push({
      id: id++,
      flowName: m.name,
      errorType,
      errorMessage,
      errorTimestamp: new Date(now - minsAgo * 60_000).toISOString(),
    })

  if (m.status === 'STATUS_FAILED' && m.errorMessage) {
    push('error', m.errorMessage, 2)
    push(
      'error',
      'failed to push batch to ClickHouse: code 252, Too many parts (300)',
      6
    )
    push('warn', 'destination ingest throughput dropped below 1k rows/s', 14)
    push('warn', 'WAL slot growth +812 MiB in last 30m', 38)
  } else if (m.status === 'STATUS_PAUSED') {
    push(
      'info',
      'mirror paused by alice@duet via state-change (maintenance window)',
      22
    )
  } else if (!m.isCdc) {
    push(
      'info',
      `partition completed in 41.2s · ${pdbN(m.rowsPerSec * 60)} rows`,
      33
    )
    push('info', 'starting next partition batch', 35)
  } else {
    push(
      'info',
      `sync flow committed ${m.rowsPerSec * 8} rows · batch_id=${14000 + (id % 999)}`,
      4
    )
    push('info', `normalize flow committed ${m.rowsPerSec} rows`, 32)
    if (m.lagSec && m.lagSec > 5)
      push(
        'warn',
        `replication lag exceeded threshold (${m.lagSec}s > 5.0s)`,
        25
      )
  }
  return { errors, total: errors.length, page: 0 }
}

function pdbN(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}

function mirrorStatus(name: string) {
  const m = mirror(name)
  if (!m) return null
  const base = {
    flowJobName: m.name,
    currentFlowState: m.status,
    createdAt: new Date(Date.now() - m.createdAgoHours * HOUR).toISOString(),
    errorMessage: m.errorMessage,
    lagSec: m.lagSec,
  }
  if (!m.isCdc) {
    return { ...base, qrepStatus: { config: {}, partitions: partitions(m) } }
  }
  return {
    ...base,
    cdcStatus: {
      config: { idleTimeoutSeconds: 10, batchSize: 100000 },
      sourceType: m.sourceType,
      destinationType: m.destinationType,
      rowsSynced: m.rowsSynced,
      snapshotStatus: { clones: [] },
      cdcBatches: cdcBatches(m).cdcBatches,
    },
  }
}

function slots(peer: string) {
  if (!peer.startsWith('pg')) return { slotData: [] }
  // pg-staging hosts the FAILED legacy_archive mirror — its slot is not draining
  // and WAL is approaching max_wal_size, so it reads as the risky/critical case.
  const risky = peer === 'pg-staging'
  return {
    slotData: [
      {
        slotName: `peerflow_slot_${peer}`,
        active: !risky,
        lagInMb: risky ? 4180.6 : 18.4,
        walStatus: risky ? 'unreserved' : 'reserved',
        redoLSN: '0/1A2B3C4D',
        restartLSN: '0/1A2B0000',
        confirmedFlushLSN: '0/1A2B3C00',
      },
    ],
  }
}

function lagHistory() {
  const now = Date.now()
  return {
    data: Array.from({ length: 24 }, (_, i) => ({
      time: new Date(now - (24 - i) * HOUR).toISOString(),
      size: Math.round((5 + seeded(i + 60) * 40) * 10) / 10,
    })),
  }
}

function peerStats(peer: string) {
  if (!peer.startsWith('pg')) return { statData: [] }
  return {
    statData: [
      {
        pid: 48213,
        state: 'active',
        query: `START_REPLICATION SLOT "peerflow_slot_${peer}" LOGICAL ...`,
        duration: 1820.4,
        waitEvent: 'WalSenderMain',
        waitEventType: 'Activity',
        queryStart: new Date(Date.now() - 1_820_000).toISOString(),
      },
    ],
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  const seg = path.split('/').filter(Boolean)
  let body: Record<string, unknown> = {}
  if (req.method === 'POST') {
    try {
      const parsed = await req.json()
      // req.json() can yield null/arrays/primitives; only accept plain objects.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>
      }
    } catch (err) {
      console.warn(`[peerdb-mock] invalid JSON body for ${path}:`, err)
    }
  }

  if (req.method === 'GET') {
    if (path === '/v1/version')
      return json({ version: '0.36.16-mock', deploymentVersion: 'mock' })
    if (path === '/v1/dynamic_settings') return json({ settings: [] })
    if (path === '/v1/mirrors/list')
      return json({
        mirrors: MIRRORS.map((m) => ({
          id: m.name,
          name: m.name,
          workflowId: m.workflowId,
          sourceName: m.source,
          sourceType: m.sourceType,
          destinationName: m.destination,
          destinationType: m.destinationType,
          createdAt: new Date(
            Date.now() - m.createdAgoHours * HOUR
          ).toISOString(),
          isCdc: m.isCdc,
          status: m.status,
        })),
      })
    if (seg[1] === 'mirrors' && seg[2] === 'cdc') {
      const flow = decodeURIComponent(seg[4] ?? '')
      const m = mirror(flow)
      if (seg[3] === 'table_total_counts' && m) return json(tableCounts(m))
      if (seg[3] === 'initial_load' && m) return json(initialLoad(m))
    }
    if (
      seg[1] === 'mirrors' &&
      seg[2] === 'total_rows_synced' &&
      seg.length === 4
    ) {
      const m = mirror(decodeURIComponent(seg[3] ?? ''))
      if (m) return json(totalRowsSynced(m))
    }
    if (seg[1] === 'peers') {
      const peer = decodeURIComponent(seg[3] ?? '')
      if (seg[2] === 'slots') return json(slots(peer))
      if (seg[2] === 'stats') return json(peerStats(peer))
      if (seg[2] === 'info') {
        const info = peerInfo(peer)
        return info ? json(info) : json({ error: 'not found' }, 404)
      }
      if (seg[2] === 'list')
        return json({
          items: PEERS.map((p) => ({ name: p.name, type: p.type })),
          sourceItems: PEERS.filter((p) => p.role === 'source').map((p) => ({
            name: p.name,
            type: p.type,
          })),
          destinationItems: PEERS.filter((p) => p.role === 'destination').map(
            (p) => ({ name: p.name, type: p.type })
          ),
        })
    }
  }

  if (req.method === 'POST') {
    const flowJobName = String(body.flowJobName ?? '')
    if (path === '/v1/mirrors/status') {
      const status = mirrorStatus(flowJobName)
      return status ? json(status) : json({ error: 'not found' }, 404)
    }
    if (path === '/v1/mirrors/cdc/graph') {
      const m = mirror(flowJobName)
      return m ? json(graphData(m)) : json({ data: [], totalRows: 0 })
    }
    if (path === '/v1/mirrors/cdc/batches') {
      const m = mirror(flowJobName)
      return m ? json(cdcBatches(m)) : json({ cdcBatches: [] })
    }
    if (path === '/v1/mirrors/logs') {
      const m = mirror(flowJobName)
      if (!m) return json({ errors: [], total: 0, page: 0 })
      const logs = mirrorLogs(m)
      const level = typeof body.level === 'string' ? body.level : ''
      if (level && level !== 'all') {
        const errors = logs.errors.filter(
          (e) => (e.errorType ?? 'info') === level
        )
        return json({ errors, total: errors.length, page: 0 })
      }
      return json(logs)
    }
    if (path === '/v1/peers/slots/lag_history') return json(lagHistory())
  }

  return json({ error: `mock: no handler for ${req.method} ${path}` }, 404)
}

Bun.serve({ port: PORT, fetch: handle })

console.log(`PeerDB mock API listening on http://localhost:${PORT}`)
console.log(
  `Point CHM at it:  PEERDB_API_URL=http://localhost:${PORT} bun run dev`
)
