/**
 * Shared fetch error handling (ported from the Next app). Reads the JSON error
 * body and throws a richly-annotated FetchError. Used by the data hooks.
 */
interface ApiErrorBody {
  error?: {
    message?: string
    type?: string
    details?: { missingTables?: readonly string[]; [key: string]: unknown }
  }
  /** Present on chart/table error responses so the UI can still review SQL. */
  metadata?: {
    sql?: string
    [key: string]: unknown
  }
}

export interface FetchError extends Error {
  status?: number
  type?: string
  details?: { missingTables?: readonly string[]; [key: string]: unknown }
  /** SQL from the failed request, when the API included it in the body. */
  sql?: string
  metadata?: ApiErrorBody['metadata']
}

export async function throwIfNotOk(
  response: Response,
  fallbackMessage = 'Request failed'
): Promise<void> {
  if (response.ok) return

  const errorData = (await response.json().catch(() => ({}))) as ApiErrorBody

  const error = new Error(
    errorData.error?.message || `${fallbackMessage}: ${response.statusText}`
  ) as FetchError

  error.status = response.status

  if (errorData.error) {
    error.type = errorData.error.type
    error.details = errorData.error.details
  }

  if (errorData.metadata) {
    error.metadata = errorData.metadata
    if (typeof errorData.metadata.sql === 'string') {
      error.sql = errorData.metadata.sql
    }
  }

  throw error
}
