import type { ConnectionStore } from './types'

import { D1ConnectionStore } from './d1-store'
import { getUserConnectionsServerConfig } from './server-feature'
import { ConnectionStoreError } from './types'
import { getPlatformBindings } from '@chm/platform'
import {
  getStateClickHouseConfig,
  getStatePostgresUrl,
} from '@/lib/state-backend/config'

const D1_BINDING_NAME = 'CHM_CLOUD_D1'

export async function resolveConnectionStore(): Promise<ConnectionStore> {
  const config = getUserConnectionsServerConfig()
  if (!config.dbStorageEnabled) {
    throw new ConnectionStoreError(
      'User connections database storage is not enabled',
      'NOT_CONFIGURED'
    )
  }

  try {
    const db = getPlatformBindings().getD1Database(D1_BINDING_NAME)
    if (db) {
      return new D1ConnectionStore()
    }
  } catch {
    // not CF
  }

  // Self-hosted ClickHouse state backend (CHM_STATE_CLICKHOUSE_*) — checked
  // after D1 (Cloud unchanged) and before Postgres.
  const chConfig = getStateClickHouseConfig()
  if (chConfig) {
    const { ClickHouseConnectionStore } = await import('./clickhouse-store')
    return new ClickHouseConnectionStore(chConfig)
  }

  if (getStatePostgresUrl()) {
    const { PostgresConnectionStore } = await import('./postgres-store')
    return new PostgresConnectionStore()
  }

  throw new ConnectionStoreError(
    'No database backend configured for user connections',
    'NOT_CONFIGURED'
  )
}

export function isConnectionStoreResolvable(): boolean {
  return getUserConnectionsServerConfig().dbStorageEnabled
}
