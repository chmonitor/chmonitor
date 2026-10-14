import type { BrowserConnection } from '@/lib/types/browser-connection'

import { apiFetch } from './api-fetch'
import { throwIfNotOk } from './fetch-error'
import { getBrowserConnectionSessionToken } from '@/lib/connection-sessions/session-manager'

interface BrowserProxyFetchParams {
  connection: BrowserConnection
  query: string
  queryParams?: Record<string, string | number | boolean>
  format?: string
}

interface ProxyResponse<T = unknown> {
  success: boolean
  data: T[]
  metadata: Record<string, unknown>
}

/**
 * Sends a query through the browser connections proxy endpoint.
 * Shared between useChartData and useTableData hooks.
 */
export async function fetchViaBrowserProxy<T = unknown>({
  connection,
  query,
  queryParams,
  format = 'JSONEachRow',
}: BrowserProxyFetchParams): Promise<{
  data: T[]
  metadata: Record<string, unknown>
}> {
  const sessionToken = await getBrowserConnectionSessionToken(connection)
  const response = await apiFetch('/api/v1/browser-connections/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionToken,
      query,
      query_params: queryParams,
      format,
    }),
  })

  await throwIfNotOk(response, 'Proxy request failed')

  const json = (await response.json()) as ProxyResponse<T>
  return { data: json.data, metadata: json.metadata }
}
