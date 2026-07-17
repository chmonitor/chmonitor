import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { runReadonlyFetch } from '../tools/helpers'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'

const SYSTEM_TABLES_TEXT = `Key ClickHouse System Tables for Monitoring:

- system.processes — Currently running queries
- system.query_log — Historical query execution log
- system.metrics — Real-time server metrics (connections, memory, etc.)
- system.events — Cumulative event counters
- system.asynchronous_metrics — Background-calculated metrics
- system.merges — Currently running merge operations
- system.parts — Data parts of MergeTree tables
- system.tables — Table metadata (sizes, row counts, engines)
- system.databases — Database list with engines
- system.columns — Column definitions for all tables
- system.disks — Disk usage information
- system.replicas — Replication status for replicated tables
- system.clusters — Cluster configuration
- system.zookeeper — ZooKeeper/Keeper node data (if configured)
- system.backup_log — Backup operation history (if configured)
- system.errors — Server error counters
`

const QUERY_EXAMPLES_TEXT = `Common chmonitor Queries:

-- Server version and uptime
SELECT version(), uptime()

-- Active connections
SELECT metric, value FROM system.metrics
WHERE metric IN ('TCPConnection', 'HTTPConnection', 'MemoryTracking')

-- Top tables by size
SELECT database, name, formatReadableSize(total_bytes) AS size, total_rows
FROM system.tables ORDER BY total_bytes DESC LIMIT 20

-- Slowest queries in the last hour
SELECT query_id, user, query_duration_ms, read_rows, memory_usage,
  substring(query, 1, 200) AS query
FROM system.query_log
WHERE type = 'QueryFinish' AND event_time > now() - INTERVAL 1 HOUR
ORDER BY query_duration_ms DESC LIMIT 10

-- Current merge operations
SELECT database, table, round(progress * 100, 2) AS pct,
  formatReadableSize(total_size_bytes_compressed) AS size, elapsed
FROM system.merges ORDER BY elapsed DESC

-- Disk usage
SELECT name, path, formatReadableSize(total_space) AS total,
  formatReadableSize(free_space) AS free
FROM system.disks

-- Replication lag
SELECT database, table, is_leader, absolute_delay,
  queue_size, inserts_in_queue, merges_in_queue
FROM system.replicas ORDER BY absolute_delay DESC
`

export function registerResources(server: McpServer) {
  server.resource(
    'system-tables',
    'clickhouse://system-tables',
    {
      description:
        'Reference of key ClickHouse system tables used for monitoring',
      mimeType: 'text/plain',
    },
    async () => ({
      contents: [
        {
          uri: 'clickhouse://system-tables',
          mimeType: 'text/plain',
          text: SYSTEM_TABLES_TEXT,
        },
      ],
    })
  )

  server.resource(
    'query-examples',
    'clickhouse://query-examples',
    {
      description: 'Example SQL queries for common ClickHouse monitoring tasks',
      mimeType: 'text/plain',
    },
    async () => ({
      contents: [
        {
          uri: 'clickhouse://query-examples',
          mimeType: 'text/plain',
          text: QUERY_EXAMPLES_TEXT,
        },
      ],
    })
  )

  server.resource(
    'databases',
    'clickhouse://databases',
    {
      description:
        'List all ClickHouse databases on host 0. For a multi-host deployment, use clickhouse://hosts/{hostId}/databases to target a different host.',
      mimeType: 'application/json',
    },
    async () => {
      const data = await queryClickHouse(
        'SELECT name, engine, comment FROM system.databases ORDER BY name'
      )
      return jsonResource('clickhouse://databases', data)
    }
  )

  server.resource(
    'database-tables',
    new ResourceTemplate('clickhouse://databases/{database}/tables', {
      list: undefined,
    }),
    {
      description:
        'List tables in a ClickHouse database on host 0. For a multi-host deployment, use clickhouse://hosts/{hostId}/databases/{database}/tables to target a different host.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const database = String(variables.database)
      const data = await queryClickHouse(
        'SELECT name, engine, total_rows, formatReadableSize(total_bytes) AS size FROM system.tables WHERE database = {db:String} ORDER BY total_bytes DESC',
        { db: database }
      )
      return jsonResource(uri.href, data)
    }
  )

  server.resource(
    'table-schema',
    new ResourceTemplate(
      'clickhouse://databases/{database}/tables/{table}/schema',
      { list: undefined }
    ),
    {
      description:
        'Get column schema for a ClickHouse table on host 0. For a multi-host deployment, use clickhouse://hosts/{hostId}/databases/{database}/tables/{table}/schema to target a different host.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const database = String(variables.database)
      const table = String(variables.table)
      const data = await queryClickHouse(
        'SELECT name, type, default_kind, default_expression, comment FROM system.columns WHERE database = {db:String} AND table = {tbl:String} ORDER BY position',
        { db: database, tbl: table }
      )
      return jsonResource(uri.href, data)
    }
  )

  server.resource(
    'table-parts',
    new ResourceTemplate(
      'clickhouse://databases/{database}/tables/{table}/parts',
      { list: undefined }
    ),
    {
      description:
        'Get active parts info for a ClickHouse table on host 0. For a multi-host deployment, use clickhouse://hosts/{hostId}/databases/{database}/tables/{table}/parts to target a different host.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const database = String(variables.database)
      const table = String(variables.table)
      const data = await queryClickHouse(
        'SELECT partition, name, rows, formatReadableSize(bytes_on_disk) AS size, modification_time FROM system.parts WHERE database = {db:String} AND table = {tbl:String} AND active ORDER BY modification_time DESC LIMIT 50',
        { db: database, tbl: table }
      )
      return jsonResource(uri.href, data)
    }
  )

  // Host-scoped variants: same data, but with an explicit {hostId} path segment
  // so multi-host deployments can address a specific ClickHouse host, mirroring
  // the `hostId` parameter every MCP tool already supports (see tools/helpers.ts).
  //
  // These are registered as a parallel `clickhouse://hosts/{hostId}/...`
  // namespace rather than folding `{hostId}` into the existing templates above:
  // the SDK's RFC 6570 `UriTemplate.match()` treats a `{?hostId}` query
  // expression as a required literal, not an optional one, so a template like
  // `clickhouse://databases{?hostId}` would fail to match the legacy
  // (no-hostId) URI and break backward compatibility.

  server.resource(
    'databases-by-host',
    new ResourceTemplate('clickhouse://hosts/{hostId}/databases', {
      list: undefined,
    }),
    {
      description: 'List all ClickHouse databases on a specific host',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const hostId = parseHostId(variables.hostId)
      const data = await queryClickHouse(
        'SELECT name, engine, comment FROM system.databases ORDER BY name',
        undefined,
        hostId
      )
      return jsonResource(uri.href, data)
    }
  )

  server.resource(
    'database-tables-by-host',
    new ResourceTemplate(
      'clickhouse://hosts/{hostId}/databases/{database}/tables',
      { list: undefined }
    ),
    {
      description: 'List tables in a ClickHouse database on a specific host',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const hostId = parseHostId(variables.hostId)
      const database = String(variables.database)
      const data = await queryClickHouse(
        'SELECT name, engine, total_rows, formatReadableSize(total_bytes) AS size FROM system.tables WHERE database = {db:String} ORDER BY total_bytes DESC',
        { db: database },
        hostId
      )
      return jsonResource(uri.href, data)
    }
  )

  server.resource(
    'table-schema-by-host',
    new ResourceTemplate(
      'clickhouse://hosts/{hostId}/databases/{database}/tables/{table}/schema',
      { list: undefined }
    ),
    {
      description:
        'Get column schema for a ClickHouse table on a specific host',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const hostId = parseHostId(variables.hostId)
      const database = String(variables.database)
      const table = String(variables.table)
      const data = await queryClickHouse(
        'SELECT name, type, default_kind, default_expression, comment FROM system.columns WHERE database = {db:String} AND table = {tbl:String} ORDER BY position',
        { db: database, tbl: table },
        hostId
      )
      return jsonResource(uri.href, data)
    }
  )

  server.resource(
    'table-parts-by-host',
    new ResourceTemplate(
      'clickhouse://hosts/{hostId}/databases/{database}/tables/{table}/parts',
      { list: undefined }
    ),
    {
      description:
        'Get active parts info for a ClickHouse table on a specific host',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const hostId = parseHostId(variables.hostId)
      const database = String(variables.database)
      const table = String(variables.table)
      const data = await queryClickHouse(
        'SELECT partition, name, rows, formatReadableSize(bytes_on_disk) AS size, modification_time FROM system.parts WHERE database = {db:String} AND table = {tbl:String} AND active ORDER BY modification_time DESC LIMIT 50',
        { db: database, tbl: table },
        hostId
      )
      return jsonResource(uri.href, data)
    }
  )
}

function jsonResource(uri: string, data: unknown[]) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  }
}

/**
 * Runs a read-only query via the same `runReadonlyFetch` helper every MCP
 * tool uses (see tools/helpers.ts), so resources honour `hostId` the exact
 * same way tools do — including the `?? 0` default when `hostId` is omitted.
 */
async function queryClickHouse(
  query: string,
  query_params?: Record<string, string>,
  hostId?: number
): Promise<unknown[]> {
  const { data } = await runReadonlyFetch<unknown[]>({
    query,
    query_params,
    hostId,
  })
  return data ?? []
}

/**
 * Parses the `{hostId}` URI template variable into a number, falling back to
 * `undefined` (which `runReadonlyFetch`/`queryClickHouse` then default to
 * host 0) for a missing or non-numeric value — fail-safe like every other
 * `hostId` entry point in this package.
 */
function parseHostId(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}
