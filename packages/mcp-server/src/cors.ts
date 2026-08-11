/**
 * CORS helpers, deliberately free of any MCP-SDK import so that lightweight
 * routes (e.g. the dashboard's /.well-known/oauth-protected-resource) can reuse
 * them WITHOUT pulling @modelcontextprotocol/server + createMcpServer into the
 * dashboard worker bundle — which would undo the separate MCP-worker split.
 */

// `*` is safe because MCP payloads are auth-gated by bearer token, not cookies.
// Expose WWW-Authenticate so cross-origin browser clients can read the OAuth
// discovery challenge on a 401 (browsers hide non-exposed response headers).
//
// Allow-Headers must list every header a browser MCP client sends, or the
// preflight fails and the real request is never made. The 2026-07-28 Streamable
// HTTP transport REQUIRES `Mcp-Method` / `Mcp-Name` on POST and carries the
// negotiated revision in `MCP-Protocol-Version`; `Mcp-Session-Id` and
// `Last-Event-ID` are only used by the pre-2026 legacy fallback but stay listed
// so older clients keep working. `accept` is needed because MCP clients send
// `Accept: application/json, text/event-stream` (not a CORS-safelisted value).
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
