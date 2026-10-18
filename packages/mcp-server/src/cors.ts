/**
 * Deliberately free of any MCP-SDK import so lightweight routes can reuse these
 * without pulling the SDK into the dashboard worker bundle.
 */

// `*` is safe because MCP payloads are auth-gated by bearer token, not cookies.
// Expose WWW-Authenticate so cross-origin browser clients can read the OAuth
// discovery challenge on a 401 (browsers hide non-exposed response headers).
//
// Allow-Headers must list every header a browser MCP client sends, or the
// preflight fails. `Mcp-Method` / `Mcp-Name` are required by the 2026-07-28
// transport; `Mcp-Session-Id` / `Last-Event-ID` serve the legacy fallback;
// `accept` is needed because `application/json, text/event-stream` is not
// CORS-safelisted.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'accept, authorization, content-type, x-api-key, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id',
  'Access-Control-Expose-Headers':
    'WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
} as const

export function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value)
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

/** CORS preflight response. Callers should answer OPTIONS with this before auth. */
export function corsPreflight(): Response {
  return withCors(new Response(null, { status: 204 }))
}
