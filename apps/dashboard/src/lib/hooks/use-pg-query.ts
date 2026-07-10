/**
 * TanStack Query hook that fetches a `PgQueryConfig`'s rows for the active
 * Postgres source via `POST /api/v1/pg/query/:name` (issue #2450).
 *
 * Sends `{ connectionId }` for server-stored (database) connections or inline
 * `{ connection }` credentials for browser connections — the server runs the
 * read-only statement through the Phase 2 Postgres client. Surfaces the
 * graceful `extensionMissing` signal so the page can render an EmptyState
 * instead of an error.
 */

import { useQuery } from '@tanstack/react-query'

import type { PgConnectionInfo } from '@/lib/hooks/use-pg-connections'

import { apiFetch } from '@/lib/swr/api-fetch'

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
  return useQuery<PgQueryResult>({
    queryKey: ['pg-query', configName, pgConn?.connectionId],
    queryFn: () => fetchPgQuery(configName, pgConn as PgConnectionInfo),
    enabled: Boolean(pgConn),
    refetchInterval: options?.refetchInterval,
    // Keep prior rows visible during background refresh (graceful pattern).
    placeholderData: (prev) => prev,
  })
}
