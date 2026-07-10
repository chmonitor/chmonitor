/**
 * Resolves the ACTIVE Postgres source from the `?pg=<connectionId>` search
 * param (issue #2450). This is the Postgres analog of `?host=<n>` — a SEPARATE
 * routing dimension so a Postgres source is never overloaded onto a ClickHouse
 * `hostId`. When a valid `?pg=` is present, the active engine is `'postgres'`
 * and the nav menu swaps to Postgres pages (decision 4).
 *
 * Fail-closed: without the feature flag / a resolvable connection, the engine
 * is `'clickhouse'`, so the ClickHouse menu is byte-for-byte unchanged.
 */

import type { SourceEngine } from '@chm/types'

import {
  type PgConnectionInfo,
  usePgConnections,
} from '@/lib/hooks/use-pg-connections'
import { useSearchParams } from '@/lib/next-compat'

/** The `?pg=` query-param name carrying the active Postgres connection id. */
export const PG_HOST_PARAM = 'pg'

/** The active Postgres connection, or `null` when no Postgres source is active. */
export function useActivePgConnection(): PgConnectionInfo | null {
  const searchParams = useSearchParams()
  const pgId = searchParams.get(PG_HOST_PARAM)
  const { getByConnectionId } = usePgConnections()
  if (!pgId) return null
  return getByConnectionId(pgId) ?? null
}

/**
 * The active host's source engine, threaded into `getVisibleMenuItems` to swap
 * the nav menu. `'postgres'` only when a valid `?pg=` is active; otherwise
 * `'clickhouse'` (ClickHouse hosts keep today's exact menu).
 */
export function useActiveHostEngine(): SourceEngine {
  return useActivePgConnection() ? 'postgres' : 'clickhouse'
}
