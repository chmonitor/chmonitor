/**
 * Server-side dashboard store resolver (used by the /api/dashboards/* routes).
 *
 * Resolution order (fail-open, OSS-first — mirrors
 * `connection-store/resolve-store.ts`):
 *   1. Cloudflare D1 binding (`CHM_CLOUD_D1`) → D1DashboardStore
 *   2. ClickHouse state env (`CHM_STATE_CLICKHOUSE_URL`) → ClickHouseDashboardStore
 *   3. Postgres env (`DATABASE_URL` / `POSTGRES_URL`) → PostgresDashboardStore
 *   4. Fallback: D1DashboardStore (throws its existing STORAGE_ERROR on use,
 *      preserving the pre-existing "no backend" behavior).
 *
 * The Postgres store is dynamically imported so the Node-only `postgres`
 * package never enters the Cloudflare Workers bundle (the CF path resolves
 * D1 first and never reaches that branch). Cloud behavior is unchanged.
 */

import type { DashboardStore } from './types'

import { D1DashboardStore } from './d1-store'
import { getPlatformBindings } from '@chm/platform'
import {
  getStateClickHouseConfig,
  getStatePostgresUrl,
} from '@/lib/state-backend/config'

const D1_BINDING_NAME = 'CHM_CLOUD_D1'

export async function resolveDashboardStore(): Promise<DashboardStore> {
  try {
    const db = getPlatformBindings().getD1Database(D1_BINDING_NAME)
    if (db) {
      return new D1DashboardStore()
    }
  } catch {
    // not Cloudflare — continue to self-hosted backends
  }

  const chConfig = getStateClickHouseConfig()
  if (chConfig) {
    const { ClickHouseDashboardStore } = await import('./clickhouse-store')
    return new ClickHouseDashboardStore(chConfig)
  }

  if (getStatePostgresUrl()) {
    const { PostgresDashboardStore } = await import('./postgres-store')
    return new PostgresDashboardStore()
  }

  return new D1DashboardStore()
}
