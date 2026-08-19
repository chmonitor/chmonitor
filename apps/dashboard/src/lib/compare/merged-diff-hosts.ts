/**
 * Resolve the same host set the sidebar uses (env + database + browser
 * session) for schema/settings compare APIs.
 *
 * Env hosts come from the operator host list (ids 0..N-1). Database connections are
 * negative ids from the per-user store. Browser connections are also negative
 * ids; the server only sees them when the client posts session tokens (or OSS
 * inline credentials), matching resolve-host-fetch.ts.
 */

import type { QueryConfig as TableQueryConfig } from '@/lib/query-config'
import type { QueryConfig } from '@/types/query-config'

import {
  type BrowserDiffSessionInput,
  type DiffPeer,
  mergeDiffPeerLists,
  parseBrowserDiffSessions,
} from './diff-peers'
import { fetchData } from '@chm/clickhouse-client' // pragma: allowlist secret
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config' // pragma: allowlist secret
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'
import { queryConnection } from '@/lib/connection-query/connection-client'
import { executeConnectionTableConfig } from '@/lib/connection-query/execute-connection-table'
import { resolveProxyCredentials } from '@/lib/connection-query/resolve-credentials'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'
import { resolveConnectionStore } from '@/lib/connection-store/resolve-store'
import { getUserConnectionsServerConfig } from '@/lib/connection-store/server-feature'

export type {
  BrowserDiffSessionInput,
  DiffPeer,
  DiffPeerKind,
} from './diff-peers'

export {
  mergeDiffPeerLists,
  parseBrowserDiffSessions,
  toHostInfo,
} from './diff-peers'

export async function readDiffRequest(request: Request): Promise<{
  search: URLSearchParams
  browserSessions: BrowserDiffSessionInput[]
}> {
  const search = new URL(request.url).searchParams
  if (request.method !== 'POST') {
    return { search, browserSessions: [] }
  }
  try {
    const body: unknown = await request.json()
    return { search, browserSessions: parseBrowserDiffSessions(body) }
  } catch {
    return { search, browserSessions: [] }
  }
}

async function listEnvPeers(
  bindings: Record<string, string | undefined>
): Promise<{ peers: DiffPeer[]; demoBlocked: boolean }> {
  const demoBlocked = await isDemoHostBlockedForRequest(0, bindings)
  if (demoBlocked) return { peers: [], demoBlocked: true }

  const configs = getClickHouseConfigsFromEnv(bindings) // pragma: allowlist secret
  return {
    demoBlocked: false,
    peers: configs.map((c) => ({
      id: c.id,
      name: c.customName ?? c.host,
      kind: 'env' as const,
      envHostId: c.id,
    })),
  }
}

async function listDatabasePeers(): Promise<DiffPeer[]> {
  if (!getUserConnectionsServerConfig().dbStorageEnabled) return []
  try {
    const userId = await resolveConnectionUserId()
    const store = await resolveConnectionStore()
    const connections = await store.list(userId)
    const peers: DiffPeer[] = []
    for (const connection of connections) {
      if (connection.engine === 'postgres') continue
      const credentials = await store.getCredentials(userId, connection.id)
      if (!credentials) continue
      peers.push({
        id: connection.hostId,
        name: connection.name,
        kind: 'database',
        credentials,
      })
    }
    return peers
  } catch {
    return []
  }
}

async function listBrowserPeers(
  sessions: BrowserDiffSessionInput[]
): Promise<DiffPeer[]> {
  const peers: DiffPeer[] = []
  for (const session of sessions) {
    const credentials = await resolveProxyCredentials(
      { sessionToken: session.sessionToken, connection: session.connection },
      null
    )
    if (!credentials) continue
    peers.push({
      id: session.hostId,
      name: session.name?.trim() || credentials.host,
      kind: 'browser',
      credentials,
    })
  }
  return peers
}

/**
 * Same order as useMergedHosts: env/demo, browser, then database. First id
 * wins if a collision sneaks in.
 */
export async function resolveMergedDiffHosts(opts: {
  bindings: Record<string, string | undefined>
  browserSessions?: BrowserDiffSessionInput[]
}): Promise<{ peers: DiffPeer[]; demoBlocked: boolean }> {
  const [env, browser, database] = await Promise.all([
    listEnvPeers(opts.bindings),
    listBrowserPeers(opts.browserSessions ?? []),
    listDatabasePeers(),
  ])

  return {
    peers: mergeDiffPeerLists(env.peers, browser, database),
    demoBlocked: env.demoBlocked,
  }
}

export async function queryDiffPeer<T>(
  peer: DiffPeer,
  opts: {
    query: string
    query_params?: Record<string, string>
    queryConfig?: QueryConfig
    optional?: boolean
  }
): Promise<T[]> {
  if (peer.credentials) {
    try {
      if (opts.queryConfig) {
        const result = await executeConnectionTableConfig(
          opts.queryConfig as TableQueryConfig,
          peer.credentials,
          opts.query_params
        )
        return result.data as T[]
      }
      const result = await queryConnection<T>(peer.credentials, opts.query, {
        query_params: opts.query_params,
      })
      return result.data
    } catch (error) {
      if (opts.optional) return []
      const message =
        error instanceof Error
          ? error.message
          : `Query failed on host ${peer.id}`
      throw new Error(message)
    }
  }

  const result = await fetchData<T[]>({
    query: opts.query,
    hostId: peer.envHostId ?? peer.id,
    format: 'JSONEachRow',
    query_params: opts.query_params,
    queryConfig: opts.queryConfig,
  })
  if (result.error || !result.data) {
    if (opts.optional) return []
    throw new Error(result.error?.message ?? `Query failed on host ${peer.id}`)
  }
  return result.data
}
