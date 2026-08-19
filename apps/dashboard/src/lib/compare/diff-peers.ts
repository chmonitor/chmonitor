import type { ConnectionCredentials } from '@/lib/connection-store/types'

export type DiffPeerKind = 'env' | 'database' | 'browser'

export type DiffPeer = {
  id: number
  name: string
  kind: DiffPeerKind
  /** Env-configured host index for fetchData. */
  envHostId?: number
  credentials?: ConnectionCredentials
}

export type BrowserDiffSessionInput = {
  hostId: number
  name?: string
  sessionToken?: string
  connection?: { host: string; user: string; password: string }
}

export function toHostInfo(peer: DiffPeer): { id: number; name: string } {
  return { id: peer.id, name: peer.name }
}

export function parseBrowserDiffSessions(
  body: unknown
): BrowserDiffSessionInput[] {
  if (!body || typeof body !== 'object') return []
  const raw = (body as { browserSessions?: unknown }).browserSessions
  if (!Array.isArray(raw)) return []

  const sessions: BrowserDiffSessionInput[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as BrowserDiffSessionInput
    if (!Number.isInteger(row.hostId) || row.hostId >= 0) continue
    const sessionToken =
      typeof row.sessionToken === 'string' && row.sessionToken
        ? row.sessionToken
        : undefined
    const connection =
      row.connection &&
      typeof row.connection.host === 'string' &&
      typeof row.connection.user === 'string'
        ? {
            host: row.connection.host,
            user: row.connection.user,
            password:
              typeof row.connection.password === 'string'
                ? row.connection.password
                : '',
          }
        : undefined
    if (!sessionToken && !connection) continue
    sessions.push({
      hostId: row.hostId,
      name: typeof row.name === 'string' ? row.name : undefined,
      sessionToken,
      connection,
    })
  }
  return sessions
}

/** Same order as useMergedHosts: env/demo, browser, then database. First id wins. */
export function mergeDiffPeerLists(
  env: DiffPeer[],
  browser: DiffPeer[],
  database: DiffPeer[]
): DiffPeer[] {
  const seen = new Set<number>()
  const peers: DiffPeer[] = []
  for (const peer of [...env, ...browser, ...database]) {
    if (seen.has(peer.id)) continue
    seen.add(peer.id)
    peers.push(peer)
  }
  return peers
}
