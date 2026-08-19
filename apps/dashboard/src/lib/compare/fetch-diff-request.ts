import type { BrowserDiffSessionInput } from '@/lib/compare/diff-peers'
import type { MergedHostInfo } from '@/lib/swr/use-merged-hosts'
import type { BrowserConnection } from '@/lib/types/browser-connection'

import { getBrowserConnectionSessionToken } from '@/lib/connection-sessions/session-manager'
import { apiFetch } from '@/lib/swr/api-fetch'

/**
 * Session tokens (or OSS inline credentials) so compare APIs can resolve
 * browser-stored hosts the same way charts/tables do via resolve-host-fetch.
 */
export async function collectBrowserDiffSessions(
  hosts: MergedHostInfo[],
  getConnectionByHostId: (
    hostId: number
  ) => BrowserConnection | undefined | null
): Promise<BrowserDiffSessionInput[]> {
  const sessions: BrowserDiffSessionInput[] = []
  for (const host of hosts) {
    if (host.source !== 'browser') continue
    const connection = getConnectionByHostId(host.id)
    if (!connection) continue
    try {
      const sessionToken = await getBrowserConnectionSessionToken(connection)
      sessions.push({
        hostId: host.id,
        name: host.name,
        sessionToken,
      })
    } catch {
      sessions.push({
        hostId: host.id,
        name: host.name,
        connection: {
          host: connection.host,
          user: connection.user,
          password: connection.password,
        },
      })
    }
  }
  return sessions
}

export async function fetchCompareDiff<T>(opts: {
  path: string
  search: Record<string, string | number | undefined>
  browserSessions: BrowserDiffSessionInput[]
}): Promise<T> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(opts.search)) {
    if (value === undefined || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  const url = qs ? `${opts.path}?${qs}` : opts.path

  const response =
    opts.browserSessions.length > 0
      ? await apiFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ browserSessions: opts.browserSessions }),
        })
      : await apiFetch(url)

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ??
        `Request failed (${response.status} ${response.statusText})`
    )
  }
  return response.json() as Promise<T>
}
