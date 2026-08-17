/**
 * Fetch wrapper for first-party dashboard API calls (ported from the Next app).
 *
 * Intercepts non-stream HTML error responses (e.g. Cloudflare's "Worker
 * exceeded resource limits" page) so they surface as real errors rather than
 * being rendered as content. Framework-agnostic — used by the TanStack Query
 * hooks as the queryFn fetcher.
 *
 * Shared by TanStack Query hooks and the AI agent chat transport.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response =
    init === undefined ? await fetch(input) : await fetch(input, init)

  const contentType = response.headers?.get?.('content-type') ?? ''
  const isStream =
    contentType.includes('text/event-stream') ||
    contentType.includes('application/json') ||
    contentType.includes('application/x-ndjson')

  if (response.ok && isStream) return response

  if (!response.ok && !isStream && contentType.includes('text/html')) {
    const bodyText = await response.clone().text()
    const truncated = bodyText.slice(0, 500)
    const isCfResourceLimit = /Worker exceeded resource limits/i.test(bodyText)
    const message = isCfResourceLimit
      ? 'Cloudflare Worker exceeded resource limits (CPU/memory). Try a smaller question, disable some tools, or use a faster model.'
      : `Request failed (${response.status} ${response.statusText || 'Error'})`
    const err = new Error(message)
    ;(err as { details?: string }).details = truncated
    throw err
  }

  return response
}
