/**
 * Schema Diff API
 * GET /api/v1/schema-diff?source=0&target=1
 *
 * Read-only catalog compare between two env-configured hosts.
 * Never executes DDL.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import {
  demoHiddenUnavailable,
  isDemoHostBlockedForRequest,
} from '@/lib/cloud/reject-demo-host'
import {
  assembleCatalog,
  buildChangePlan,
  compareCatalogs,
  emptySchemaDiffPayload,
  type ColumnRow,
  type IndexRow,
  type ProjectionRow,
  type TableRow,
} from '@/lib/schema-diff'

const USER_DB_FILTER = `database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')`

const TABLES_QUERY = `
  SELECT
    database,
    name AS table,
    engine,
    sorting_key,
    partition_key,
    primary_key,
    create_table_query
  FROM system.tables
  WHERE ${USER_DB_FILTER}
  ORDER BY database, name
`

const COLUMNS_QUERY = `
  SELECT
    database,
    table,
    name,
    type,
    ifNull(compression_codec, '') AS codec
  FROM system.columns
  WHERE ${USER_DB_FILTER}
  ORDER BY database, table, position
`

const INDEXES_QUERY = `
  SELECT
    database,
    table,
    name,
    type,
    expr,
    toString(granularity) AS granularity
  FROM system.data_skipping_indices
  WHERE ${USER_DB_FILTER}
  ORDER BY database, table, name
`

const PROJECTIONS_QUERY = `
  SELECT
    database,
    table,
    name,
    type,
    ifNull(query, '') AS query
  FROM system.projections
  WHERE ${USER_DB_FILTER}
  ORDER BY database, table, name
`

async function queryRows<T>(
  hostId: number,
  query: string,
  options?: { optional?: boolean }
): Promise<T[]> {
  const result = await fetchData<T[]>({
    query,
    hostId,
    format: 'JSONEachRow',
  })
  if (result.error || !result.data) {
    if (options?.optional) return []
    const message =
      result.error?.message ?? `Catalog query failed on host ${hostId}`
    throw new Error(message)
  }
  return result.data
}

async function loadCatalog(hostId: number) {
  const [tables, columns, indexes, projections] = await Promise.all([
    queryRows<TableRow>(hostId, TABLES_QUERY),
    queryRows<ColumnRow>(hostId, COLUMNS_QUERY),
    queryRows<IndexRow>(hostId, INDEXES_QUERY, { optional: true }),
    queryRows<ProjectionRow>(hostId, PROJECTIONS_QUERY, { optional: true }),
  ])
  return assembleCatalog(tables, columns, indexes, projections)
}

function parseHostId(raw: string | null): number | null {
  if (raw === null || raw === '') return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

export const Route = createFileRoute('/api/v1/schema-diff')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)

        const configs = getClickHouseConfigsFromEnv(
          env as Record<string, string | undefined>
        )

        if (configs.length === 0) {
          return Response.json(
            { success: false, error: 'No ClickHouse hosts configured' },
            { status: 503 }
          )
        }

        if (
          await isDemoHostBlockedForRequest(
            0,
            env as Record<string, string | undefined>
          )
        ) {
          return Response.json(
            emptySchemaDiffPayload({
              success: true,
              hosts: [],
              sourceHostId: null,
              targetHostId: null,
              unavailable: demoHiddenUnavailable(),
            })
          )
        }

        const hosts = configs.map((c) => ({
          id: c.id,
          name: c.customName ?? c.host,
        }))

        if (hosts.length < 2) {
          return Response.json(
            emptySchemaDiffPayload({
              success: true,
              hosts,
              sourceHostId: hosts[0]?.id ?? null,
              targetHostId: null,
            })
          )
        }

        const searchParams = new URL(request.url).searchParams
        const requestedSource = parseHostId(searchParams.get('source'))
        const requestedTarget = parseHostId(searchParams.get('target'))

        const ids = new Set(hosts.map((h) => h.id))
        const sourceHostId =
          requestedSource !== null && ids.has(requestedSource)
            ? requestedSource
            : hosts[0].id
        const fallbackTarget = hosts.find((h) => h.id !== sourceHostId)!.id
        const targetHostId =
          requestedTarget !== null &&
          ids.has(requestedTarget) &&
          requestedTarget !== sourceHostId
            ? requestedTarget
            : fallbackTarget

        try {
          const [sourceCatalog, targetCatalog] = await Promise.all([
            loadCatalog(sourceHostId),
            loadCatalog(targetHostId),
          ])

          const diff = compareCatalogs(sourceCatalog, targetCatalog)
          const plan = buildChangePlan(diff)

          return Response.json({
            success: true,
            hosts,
            sourceHostId,
            targetHostId,
            diff,
            plan,
          })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Catalog query failed'
          return Response.json(
            { success: false, error: message },
            { status: 502 }
          )
        }
      },
    },
  },
})
