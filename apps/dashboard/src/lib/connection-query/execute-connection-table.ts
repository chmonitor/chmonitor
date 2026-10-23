import type { VersionedSql } from '@chm/sql-builder'
import type { ConnectionCredentials } from '@/lib/connection-store/types'
import type { QueryConfig } from '@/lib/query-config'

import { getConnectionVersion, queryConnection } from './connection-client'
import { displaySql } from '@chm/clickhouse-client/attribution'
import {
  type ClickHouseVersion,
  parseVersion,
  selectVersionedSql,
} from '@chm/clickhouse-client/clickhouse-version'
import { dropUnsupportedSettings } from '@/lib/api/table-query-settings'

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

async function getVersionForConnection(
  credentials: ConnectionCredentials
): Promise<ClickHouseVersion | null> {
  const versionStr = await getConnectionVersion(credentials)
  return versionStr ? parseVersion(versionStr) : null
}

function selectSqlForVersion(
  sql: string | VersionedSql[],
  version: ClickHouseVersion | null
): string {
  return typeof sql === 'string' ? sql : selectVersionedSql(sql, version)
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
  const configSettings = primitiveSettings(queryConfig.clickhouseSettings)
  // The version picks the SQL variant and drops settings it rejects; skip the
  // round-trip when neither applies.
  const version =
    typeof queryConfig.sql !== 'string' ||
    Object.keys(configSettings).length > 0
      ? await getVersionForConnection(credentials)
      : null
  const executedSql = selectSqlForVersion(queryConfig.sql, version)

  const start = Date.now()
  const clickhouse_settings: Record<string, string | number> = {
    ...dropUnsupportedSettings(configSettings, version),
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
    // The connection client sends no host name, so the shown comment has none.
    executedSql: displaySql(executedSql, null),
  }
}
