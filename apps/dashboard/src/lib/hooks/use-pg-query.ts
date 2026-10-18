/**
 * Sends `{ connectionId }` for server-stored connections or inline
 * `{ connection }` credentials for browser connections. Surfaces the graceful
 * `extensionMissing` signal so the page can render an EmptyState instead of an error.
 */

import { useQuery } from '@tanstack/react-query'

import type { PgConnectionInfo } from '@/lib/hooks/use-pg-connections'

import { useCloudAccess } from '@/lib/cloud/use-cloud-access'
import { apiFetch } from '@/lib/swr/api-fetch'
import { visibilityAwareInterval } from '@/lib/swr/config'

export interface PgQueryResult {
  data: Record<string, unknown>[]
  extensionMissing: boolean
  extension?: string
  metadata?: { duration?: number; rows?: number }
}

interface PgQueryApiResponse {
  success: boolean
  data?: Record<string, unknown>[]
  metadata?: { duration?: number; rows?: number }
  extensionMissing?: boolean
  extension?: string
  error?: { type: string; message: string }
}

function buildBody(pgConn: PgConnectionInfo): Record<string, unknown> {
  if (pgConn.source === 'database') {
    return { connectionId: pgConn.connectionId }
  }
  return {
    connection: {
      host: pgConn.host,
      user: pgConn.user,
      password: pgConn.password ?? '',
      port: pgConn.port,
      database: pgConn.database,
      sslmode: pgConn.sslmode,
    },
  }
}

async function fetchPgQuery(
  configName: string,
  pgConn: PgConnectionInfo
): Promise<PgQueryResult> {
  const res = await apiFetch(`/api/v1/pg/query/${configName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(pgConn)),
  })
  const json = (await res.json()) as PgQueryApiResponse
  if (!res.ok || !json.success) {
    throw new Error(
      json.error?.message ?? `Postgres query failed (${res.status})`
    )
  }
  return {
    data: json.data ?? [],
    extensionMissing: Boolean(json.extensionMissing),
    extension: json.extension,
    metadata: json.metadata,
  }
}

export function usePgQuery(
  configName: string,
  pgConn: PgConnectionInfo | null,
  options?: { refetchInterval?: number }
) {
  const canRead = useCloudAccess() === 'open'
  return useQuery<PgQueryResult>({
    queryKey: ['pg-query', configName, pgConn?.connectionId],
    queryFn: () => fetchPgQuery(configName, pgConn as PgConnectionInfo),
    enabled: Boolean(pgConn) && canRead,
    // Gate at the hook rather than each call site: /postgres/activity polls
    // every 5s, which is the fastest interval in the app and the least
    // affordable to leave running in a background tab.
    refetchInterval: options?.refetchInterval
      ? visibilityAwareInterval(options.refetchInterval)
      : undefined,
    placeholderData: (prev) => prev,
  })
}
