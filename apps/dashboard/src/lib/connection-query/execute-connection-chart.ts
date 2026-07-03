import type { VersionedSql } from '@chm/sql-builder'
import type { ConnectionCredentials } from '@/lib/connection-store/types'

import { getConnectionVersion, queryConnection } from './connection-client'
import {
  parseVersion,
  selectVersionedSql,
} from '@chm/clickhouse-client/clickhouse-version'
import { type ChartQueryParams, getChartQuery } from '@/lib/api/chart-registry'

async function selectSqlForConnection(
  sql: string | VersionedSql[],
  credentials: ConnectionCredentials
): Promise<{ sql: string; version?: string }> {
  if (typeof sql === 'string') return { sql }
  const versionStr = await getConnectionVersion(credentials)
  const version = versionStr ? parseVersion(versionStr) : null
  return {
    sql: selectVersionedSql(sql, version),
    version: versionStr ?? undefined,
  }
}

export async function executeConnectionChartQuery(
  chartName: string,
  credentials: ConnectionCredentials,
  chartParams: ChartQueryParams = {},
  timezone?: string
): Promise<{
  data: unknown[] | Record<string, unknown>
  metadata: Record<string, string | number>
  executedSql: string
  clickhouseVersion?: string
}> {
  const queryDef = getChartQuery(chartName, chartParams)
  if (!queryDef) {
    throw new Error(`Chart not found: ${chartName}`)
  }

  if ('queries' in queryDef) {
    const start = Date.now()

    const entries = await Promise.all(
      queryDef.queries.map(async (q) => {
        const { data } = await queryConnection<Record<string, unknown>>(
          credentials,
          q.query,
          {
            clickhouse_settings: timezone
              ? { session_timezone: timezone }
              : undefined,
          }
        )
        return [q.key, data, q.query] as const
      })
    )

    const combined: Record<string, unknown[]> = {}
    let executedSql = ''
    for (const [key, data, query] of entries) {
      combined[key] = data
      executedSql += `${key}: ${query}\n`
    }

    return {
      data: combined,
      metadata: { duration: Date.now() - start, rows: queryDef.queries.length },
      executedSql,
    }
  }

  const sqlSource = queryDef.sql ?? queryDef.query
  const { sql: executedSql, version } = await selectSqlForConnection(
    sqlSource,
    credentials
  )

  const start = Date.now()
  const { data, queryId } = await queryConnection<Record<string, unknown>>(
    credentials,
    executedSql,
    {
      query_params: queryDef.queryParams as
        | Record<string, string | number | boolean>
        | undefined,
      clickhouse_settings: timezone
        ? { session_timezone: timezone }
        : undefined,
    }
  )

  return {
    data,
    metadata: {
      duration: Date.now() - start,
      rows: data.length,
      ...(queryId ? { queryId } : {}),
      ...(version ? { clickhouseVersion: version } : {}),
    },
    executedSql,
    clickhouseVersion: version,
  }
}
