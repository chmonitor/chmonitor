/**
 * Client-side registry of the visitor's Postgres connections (issue #2450).
 *
 * Postgres sources are deliberately EXCLUDED from `useMergedHosts` / the
 * ClickHouse host id-space (they would be mis-queried as ClickHouse hostIds).
 * The engine-aware host switcher and the Postgres pages instead select a
 * Postgres source by its `connectionId` via this hook, which unifies the two
 * storage origins:
 *   - `database` — per-user connections stored encrypted on the server (D1).
 *     Credentials never reach the client; the query route resolves them by
 *     `connectionId`.
 *   - `browser`  — connections stored (encrypted) in this browser. Credentials
 *     ARE available client-side and are POSTed inline to the query route.
 *
 * Fail-closed: returns an empty list unless `CHM_FEATURE_POSTGRES_SOURCE` is on.
 */

import { useMemo } from 'react'
import { featureFlags } from '@/lib/feature-flags'
import { useBrowserConnections } from '@/lib/hooks/use-browser-connections'
import { useUserConnections } from '@/lib/hooks/use-user-connections'

export interface PgConnectionInfo {
  /** UUID — server connection id (database) or browser connection id. */
  connectionId: string
  source: 'database' | 'browser'
  name: string
  /** Bare hostname/IP (no scheme). */
  host: string
  user: string
  database?: string
  port?: number
  sslmode?: string
  /**
   * Browser-only: the password is available client-side for the inline POST.
   * Absent for `database` connections (server resolves those by id).
   */
  password?: string
}

export interface UsePgConnectionsResult {
  connections: PgConnectionInfo[]
  isLoading: boolean
  getByConnectionId: (id: string) => PgConnectionInfo | undefined
}

export function usePgConnections(): UsePgConnectionsResult {
  const enabled = featureFlags.postgresSource()

  const {
    connections: dbConnections,
    isLoading: dbLoading,
    featureEnabled: dbFeatureEnabled,
    isSignedIn,
  } = useUserConnections(enabled)
  const { connections: browserConnections, mounted } = useBrowserConnections()

  const connections = useMemo<PgConnectionInfo[]>(() => {
    if (!enabled) return []

    const fromDatabase: PgConnectionInfo[] =
      dbFeatureEnabled && isSignedIn
        ? dbConnections
            .filter((c) => c.engine === 'postgres')
            .map((c) => ({
              connectionId: c.id,
              source: 'database' as const,
              name: c.name,
              host: c.host,
              user: c.user,
            }))
        : []

    const fromBrowser: PgConnectionInfo[] = browserConnections
      .filter((c) => c.engine === 'postgres')
      .map((c) => ({
        connectionId: c.id,
        source: 'browser' as const,
        name: c.name,
        host: c.host,
        user: c.user,
        database: c.database,
        port: c.port,
        sslmode: c.sslmode,
        password: c.password,
      }))

    return [...fromDatabase, ...fromBrowser]
  }, [enabled, dbConnections, dbFeatureEnabled, isSignedIn, browserConnections])

  const getByConnectionId = useMemo(() => {
    const byId = new Map(connections.map((c) => [c.connectionId, c]))
    return (id: string) => byId.get(id)
  }, [connections])

  return {
    connections,
    isLoading: enabled && (dbLoading || !mounted),
    getByConnectionId,
  }
}
