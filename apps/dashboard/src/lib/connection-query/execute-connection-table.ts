import type { VersionedSql } from '@chm/sql-builder'
import type { ConnectionCredentials } from '@/lib/connection-store/types'
import type { QueryConfig } from '@/lib/query-config'

import { getConnectionVersion, queryConnection } from './connection-client'
import {
  parseVersion,
  selectVersionedSql,
} from '@chm/clickhouse-client/clickhouse-version'

/** Keep the config's string/number settings (e.g. `max_execution_time`). */
function primitiveSettings(
  settings: QueryConfig['clickhouseSettings']
): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(settings ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') out[key] = value
  }
  return out
}

async function selectSqlForConnection(
  sql: string | VersionedSql[],
  credentials: ConnectionCredentials
): Promise<string> {
  if (typeof sql === 'string') return sql
  const versionStr = await getConnectionVersion(credentials)
  const version = versionStr ? parseVersion(versionStr) : null
  return selectVersionedSql(sql, version)
}

export async function executeConnectionTableConfig<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  queryConfig: QueryConfig,
  credentials: ConnectionCredentials,
  queryParams?: Record<string, unknown>,
  timezone?: string
): Promise<{
  data: T[]
  metadata: Record<string, string | number>
  executedSql: string
}> {
  const executedSql = await selectSqlForConnection(queryConfig.sql, credentials)

  const start = Date.now()
  const clickhouse_settings: Record<string, string | number> = {
    ...primitiveSettings(queryConfig.clickhouseSettings),
    ...(timezone ? { session_timezone: timezone } : {}),
  }

  const { data, queryId } = await queryConnection<T>(credentials, executedSql, {
    query_params: queryParams as Record<string, string | number | boolean>,
    clickhouse_settings,
  })

  return {
    data,
    metadata: {
      duration: Date.now() - start,
      rows: data.length,
      ...(queryId ? { queryId } : {}),
    },
    executedSql,
  }
}
