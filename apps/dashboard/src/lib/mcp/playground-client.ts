/**
 * A minimal, dependency-free MCP client for the /mcp Playground tab.
 *
 * The Playground talks to OUR OWN endpoint (`/api/mcp`) from the browser, so it
 * only ever needs two calls — `tools/list` and `tools/call`. Hand-rolling those
 * as JSON-RPC fetches keeps the MCP client SDK out of the dashboard bundle (the
 * worker has a hard size budget) while still speaking the 2026-07-28 wire
 * format the server negotiates.
 *
 * Everything here is pure/isomorphic and unit-tested against the real
 * `handleMcp` handler — see `__tests__/playground-client.test.ts`.
 */

/** Protocol revision this client speaks. Must be one the server supports. */
export const MCP_PROTOCOL_VERSION = '2026-07-28'

/** JSON Schema fragment as returned by `tools/list` (JSON Schema 2020-12). */
export interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  description?: string
  default?: unknown
  enum?: unknown[]
  items?: JsonSchema
  [key: string]: unknown
}

export interface McpToolDescriptor {
  name: string
  title?: string
  description?: string
  inputSchema?: JsonSchema
  outputSchema?: JsonSchema
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

export interface McpContentBlock {
  type: string
  text?: string
  [key: string]: unknown
}

export interface McpCallResult {
  content?: McpContentBlock[]
  structuredContent?: unknown
  isError?: boolean
  [key: string]: unknown
}

/** Why a call failed, so the UI can react (auth prompt vs plain error). */
export type McpErrorKind =
  | 'unauthorized'
  | 'payment_required'
  | 'forbidden'
  | 'rate_limited'
  | 'protocol'
  | 'network'

export class McpRequestError extends Error {
  constructor(
    message: string,
    readonly kind: McpErrorKind,
    readonly status?: number
  ) {
    super(message)
    this.name = 'McpRequestError'
  }
}

/** Map an HTTP status to the error kind the Playground reacts to. */
export function errorKindForStatus(status: number): McpErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 402) return 'payment_required'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'rate_limited'
  return 'network'
}

export interface McpRequestOptions {
  /** Endpoint URL, e.g. `${origin}/api/mcp`. */
  endpoint: string
  /** Optional credential — sent as `x-api-key` AND as a bearer token. */
  apiKey?: string
}

/**
 * Build the JSON-RPC envelope for a method call.
 *
 * Under 2026-07-28 there is no `initialize` handshake: every request declares
 * its protocol version in `_meta` (and, on Streamable HTTP, in the
 * `MCP-Protocol-Version` header), so a single POST is a complete conversation.
 */
export function buildJsonRpcRequest(
  method: string,
  params: Record<string, unknown> | undefined,
  id: number | string = 1
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...(params ?? {}),
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
        // Required on every request under 2026-07-28 — the handshake is gone,
        // so capabilities travel per-request. The Playground is a plain
        // request/response client: it implements no client-side features.
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': {
          name: 'chmonitor-playground',
          version: '1',
        },
      },
    },
  }
}

/**
 * Headers for a Streamable HTTP POST.
 *
 * `Mcp-Method` / `Mcp-Name` are REQUIRED by 2026-07-28 (they let proxies route
 * and authorize without parsing the body); `Mcp-Name` carries the tool name for
 * `tools/call` and is omitted for methods that address no named entity.
 */
export function buildMcpHeaders({
  method,
  name,
  apiKey,
}: {
  method: string
  name?: string
  apiKey?: string
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    'Mcp-Method': method,
  }
  if (name) headers['Mcp-Name'] = name
  if (apiKey) {
    headers['x-api-key'] = apiKey
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

/**
 * Parse an MCP HTTP response body.
 *
 * The transport may answer with plain JSON or with an SSE stream (the server
 * picks per request), so accept both. For SSE we take the LAST `data:` payload
 * that parses as the JSON-RPC response — earlier events are progress/log
 * notifications, which the Playground does not render.
 */
export function parseMcpBody(
  contentType: string | null,
  body: string
): Record<string, unknown> {
  if (contentType?.includes('text/event-stream')) {
    let last: Record<string, unknown> | null = null
    for (const line of body.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice('data:'.length).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>
        // Notifications have no `id`; keep the actual response.
        if ('result' in parsed || 'error' in parsed) last = parsed
      } catch {
        // Ignore partial/non-JSON events.
      }
    }
    if (!last) {
      throw new McpRequestError(
        'The server returned an event stream with no JSON-RPC response.',
        'protocol'
      )
    }
    return last
  }

  try {
    return JSON.parse(body) as Record<string, unknown>
  } catch {
    throw new McpRequestError(
      `The server returned a non-JSON response: ${body.slice(0, 200)}`,
      'protocol'
    )
  }
}

/** One request/response pair, kept for the inspector panel. */
export interface McpExchange {
  request: Record<string, unknown>
  headers: Record<string, string>
  status: number
  response: Record<string, unknown>
  durationMs: number
}

async function callMcp(
  method: string,
  params: Record<string, unknown> | undefined,
  { endpoint, apiKey }: McpRequestOptions,
  name?: string
): Promise<{ result: unknown; exchange: McpExchange }> {
  const request = buildJsonRpcRequest(method, params)
  const headers = buildMcpHeaders({ method, name, apiKey })
  const startedAt = Date.now()

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    })
  } catch (err) {
    throw new McpRequestError(
      err instanceof Error ? err.message : 'Network request failed',
      'network'
    )
  }

  const text = await res.text()
  const durationMs = Date.now() - startedAt

  if (!res.ok) {
    // Redact the credential before it can reach an inspector panel or a log.
    throw new McpRequestError(
      text.slice(0, 300) || `Request failed with HTTP ${res.status}`,
      errorKindForStatus(res.status),
      res.status
    )
  }

  const response = parseMcpBody(res.headers.get('content-type'), text)
  const exchange: McpExchange = {
    request,
    headers: { ...headers, ...(apiKey ? redactedCredentials() : {}) },
    status: res.status,
    response,
    durationMs,
  }

  if (response.error) {
    const error = response.error as { message?: string; code?: number }
    throw new McpRequestError(
      error.message ?? 'The server returned a JSON-RPC error.',
      'protocol',
      res.status
    )
  }

  return { result: response.result, exchange }
}

function redactedCredentials(): Record<string, string> {
  return { 'x-api-key': '<redacted>', Authorization: 'Bearer <redacted>' }
}

/** Discover the tools the live endpoint actually exposes. */
export async function listTools(
  options: McpRequestOptions
): Promise<{ tools: McpToolDescriptor[]; exchange: McpExchange }> {
  const { result, exchange } = await callMcp('tools/list', {}, options)
  const tools = (result as { tools?: McpToolDescriptor[] } | undefined)?.tools
  return { tools: tools ?? [], exchange }
}

/** Invoke a tool and return its result envelope. */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  options: McpRequestOptions
): Promise<{ result: McpCallResult; exchange: McpExchange }> {
  const { result, exchange } = await callMcp(
    'tools/call',
    { name, arguments: args },
    options,
    name
  )
  return { result: (result ?? {}) as McpCallResult, exchange }
}

/** Concatenate the text blocks of a result for the "Text" view. */
export function resultText(result: McpCallResult): string {
  return (result.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
}
