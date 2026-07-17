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

/**
 * Human-readable detail for a failed request, for a toast `description`.
 *
 * The panels pair this with their own action-specific title ("Failed to delete
 * subscription"), so the toast keeps saying *what* failed while this adds *why*
 * — the server's message and/or the HTTP status, which is what distinguishes a
 * 403 from a 500 from a dropped connection.
 *
 * Returns `undefined` when the error carries nothing beyond what the caller's
 * title already says, so the toast renders clean rather than with an empty or
 * meaningless second line.
 */
export function describeError(err: unknown): string | undefined {
  const message =
    err instanceof Error
      ? err.message.trim()
      : typeof err === 'string'
        ? err.trim()
        : ''
  const status = err instanceof Error ? (err as FetchError).status : undefined

  if (!message) return status ? `HTTP ${status}` : undefined
  // `throwIfNotOk` already appends statusText to its fallback message, so only
  // add the status when the message doesn't already carry it.
  return status !== undefined && !message.includes(String(status))
    ? `${message} (HTTP ${status})`
    : message
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
