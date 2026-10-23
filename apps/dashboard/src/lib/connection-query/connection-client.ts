import type { DataFormat } from '@clickhouse/client'
import { createClient } from '@clickhouse/client-web'

import type { ConnectionCredentials } from '@/lib/connection-store/types'

import { withQueryAttribution } from '@chm/clickhouse-client/attribution'
import { createHostValidationFetch } from '@/lib/browser-connections/host-url'

export type ConnectionClient = ReturnType<typeof createClient>

export function createConnectionClient(
  credentials: ConnectionCredentials
): ConnectionClient {
  return withQueryAttribution(
    createClient({
      host: credentials.host,
      username: credentials.user,
      password: credentials.password,
      fetch: createHostValidationFetch(),
    }),
    null
  )
}

export async function queryConnection<T = unknown>(
  credentials: ConnectionCredentials,
  query: string,
  options?: {
    query_params?: Record<string, string | number | boolean>
    format?: DataFormat
    clickhouse_settings?: Record<string, string | number>
  }
): Promise<{ data: T[]; queryId?: string; duration: number }> {
  const start = Date.now()
  const client = createConnectionClient(credentials)
  const result = await client.query({
    query,
    query_params: options?.query_params,
    format: (options?.format ?? 'JSONEachRow') as DataFormat,
    clickhouse_settings: options?.clickhouse_settings,
  })
  const data = (await result.json()) as T[]
  return {
    data: Array.isArray(data) ? data : [],
    queryId: result.query_id,
    duration: Date.now() - start,
  }
}

export async function getConnectionVersion(
  credentials: ConnectionCredentials
): Promise<string | null> {
  try {
    const { data } = await queryConnection<{ version: string }>(
      credentials,
      'SELECT version() AS version'
    )
    return data[0]?.version ?? null
  } catch {
    return null
  }
}
