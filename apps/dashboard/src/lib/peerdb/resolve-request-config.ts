/**
 * Resolve the PeerDB config a proxy request should use — either a per-user
 * connection's stored config (`?connection=<id>`) or the env-wide default.
 *
 * Server-only (imports the D1/Postgres connection store + Clerk auth). Runs in
 * the same Cloudflare Workers runtime as `api/v1/user-connections.ts`, which
 * already resolves user credentials this way.
 *
 * Fail-closed: a `?connection=<id>` that can't be resolved (not signed in, not
 * owned, no PeerDB link, or user-connection storage disabled) returns `null`,
 * so the caller reports not-configured and never leaks whether the connection
 * exists. `store.getCredentials(userId, id)` is scoped to the signed-in user,
 * so ownership is enforced by the query itself.
 */

import {
  envPeerDBConfig,
  PEERDB_CONNECTION_PARAM,
  peerdbConfigFromCredentials,
  type ResolvedPeerDBConfig,
} from './peerdb-auth'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'
import { resolveConnectionStore } from '@/lib/connection-store/resolve-store'
import { getUserConnectionsServerConfig } from '@/lib/connection-store/server-feature'

export { PEERDB_CONNECTION_PARAM }

export async function resolvePeerDBRequestConfig(
  request: Request,
  bindings: Record<string, string | undefined>
): Promise<ResolvedPeerDBConfig | null> {
  const connectionId = new URL(request.url).searchParams.get(
    PEERDB_CONNECTION_PARAM
  )

  // No selector → env-wide config (unchanged from today).
  if (!connectionId) return envPeerDBConfig(bindings)

  // Per-connection: read the PeerDB link from the owner's encrypted envelope.
  if (!getUserConnectionsServerConfig().dbStorageEnabled) return null
  try {
    const userId = await resolveConnectionUserId(request)
    const store = await resolveConnectionStore()
    const creds = await store.getCredentials(userId, connectionId)
    if (!creds) return null
    return peerdbConfigFromCredentials(creds)
  } catch {
    // Unauthorized / store error / lookup miss all fail closed.
    return null
  }
}
