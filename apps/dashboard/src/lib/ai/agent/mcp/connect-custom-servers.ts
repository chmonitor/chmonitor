/**
 * Custom MCP server connection helper.
 *
 * Connects to user-supplied MCP endpoints at request time, merges their tools
 * into the agent's tool set (prefixed to avoid clobbering built-ins), and
 * provides a closeAll() for stream-end cleanup.
 *
 * Security: each endpoint passes an SSRF guard before any network call is
 * made. The guard reuses the shared `validateHostUrl` used for ClickHouse
 * connections — it resolves the hostname and rejects the endpoint if ANY
 * resolved A/AAAA address is private/reserved (defeating DNS-rebinding and
 * names that point at internal ranges), on top of rejecting non-`::1` IPv6
 * literals and numeric-/hex-/octal-encoded IPv4 hosts. http: is only
 * permitted on loopback hosts (dev convenience).
 */

import {
  isMcpRegistryEnabled,
  type McpAuth,
  type McpConnectInput,
  type McpRegistrationStore,
  type McpTransport,
  mcpRegistrationStore,
} from './registration-store'
import { createMCPClient } from '@ai-sdk/mcp'
import {
  createHostValidationFetch,
  type ResolveHostAddresses,
  validateHostUrl,
} from '@/lib/browser-connections/host-url'

export interface CustomMcpServerInput {
  id: string
  name: string
  endpoint: string
  /** Transport to open the client over. Defaults to 'http'. */
  transport?: McpTransport
  /** Structured auth; defaults to no auth. */
  auth?: McpAuth
}

export interface McpConnectionResult {
  tools: Record<string, unknown>
  closeAll: () => Promise<void>
  statuses: Array<{
    id: string
    status: 'connected' | 'error'
    toolCount: number
    error?: string
  }>
}

/** Minimal MCP client surface used here (subset of the AI SDK client). */
interface McpClientLike {
  tools: () => Promise<Record<string, unknown>>
  close: () => Promise<void>
}

/**
 * Factory for opening an MCP client. Injected in tests so the connect/close
 * lifecycle (and failure paths) can be driven without a live network call —
 * the default builds a real, SSRF-pinned AI SDK client (see
 * {@link defaultCreateMcpClient}).
 */
export type McpClientFactory = (args: {
  url: string
  transport: McpTransport
  headers?: Record<string, string>
  serverName: string
}) => Promise<McpClientLike>

/** Options accepted across the connect helpers (test seams). */
export interface ConnectOptions {
  createClient?: McpClientFactory
  resolveHostAddresses?: ResolveHostAddresses
}

/** Maximum number of custom servers to connect per request. */
const MAX_SERVERS = 5

/** Per-server connect+tools timeout in milliseconds. */
const CONNECT_TIMEOUT_MS = 8_000

// ---------------------------------------------------------------------------
// URL guard
// ---------------------------------------------------------------------------

/**
 * Returns true when the URL is safe to connect to as an MCP endpoint.
 *
 * Allowed:
 *   - https: on a publicly-routable hostname whose every resolved A/AAAA
 *     address is public (verified by the shared `validateHostUrl` SSRF guard)
 *   - http:/https: on localhost / 127.0.0.1 / [::1] (dev convenience)
 *
 * Rejected:
 *   - non-http/https protocols
 *   - http: on non-loopback hosts
 *   - non-`::1` IPv6 literals (public or private)
 *   - numeric-/hex-/octal-encoded IPv4 hosts (e.g. 2130706433, 0x7f000001,
 *     0177.0.0.1, 127.1) that bypass simple dotted-quad checks
 *   - any host that resolves (or is) a private/reserved/loopback/CGNAT
 *     address — including DNS names that point at internal ranges
 *
 * Async because it performs DNS resolution via `validateHostUrl`. The optional
 * `resolveHostAddresses` override is for tests (avoids real DNS).
 */
export async function isAllowedMcpUrl(
  raw: string,
  resolveHostAddresses?: ResolveHostAddresses
): Promise<boolean> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }

  const { protocol } = url
  if (protocol !== 'https:' && protocol !== 'http:') return false

  // Reject obfuscated integer IPv4 encodings using the RAW host token, BEFORE
  // new URL() canonicalises them into an innocent-looking dotted quad (e.g.
  // 2130706433 / 0x7f000001 / 0177.0.0.1 / 127.1 all become 127.0.0.1). This
  // runs first so such forms can never slip through the loopback allowance.
  if (isNumericEncodedHost(rawHostname(raw))) return false

  // Normalise the hostname (lowercase, strip IPv6 brackets) as validateHostUrl
  // does, so our extra literal checks agree with the shared guard.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  const isLoopback =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'

  // http is only permitted for loopback (dev convenience).
  if (protocol === 'http:') return isLoopback

  // Loopback over https is fine and needs no DNS resolution.
  if (isLoopback) return true

  // Reject any remaining IPv6 literal (only ::1 is allowed, handled above).
  // IPv6 SSRF filtering is subtle, so refuse all other v6 literals outright.
  if (hostname.includes(':')) return false

  // Delegate the SSRF decision to the shared guard: it resolves the hostname
  // and rejects when it (or any resolved A/AAAA) is private/reserved. Honors
  // CHM_ALLOW_PRIVATE_HOSTS exactly like ClickHouse connections do.
  const error = await validateHostUrl(raw, resolveHostAddresses)
  return error === null
}

/**
 * Extract the raw host token from a URL string (host between scheme and the
 * path/port, after any userinfo, with IPv6 brackets stripped) WITHOUT going
 * through `new URL()`, whose parser canonicalises integer IPv4 encodings. Used
 * to detect those encodings before they are normalised away.
 */
function rawHostname(raw: string): string {
  const afterScheme = raw.slice(raw.indexOf('://') + 3)
  const authority = afterScheme.split(/[/?#]/, 1)[0] ?? ''
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1)

  if (hostPort.startsWith('[')) {
    const end = hostPort.indexOf(']')
    return hostPort.slice(1, end === -1 ? undefined : end).toLowerCase()
  }

  const colon = hostPort.indexOf(':')
  return (colon === -1 ? hostPort : hostPort.slice(0, colon)).toLowerCase()
}

/**
 * Returns true for hosts that are numeric/hex/octal IPv4 encodings rather than
 * a real hostname or a clean dotted-decimal IPv4 quad. Fed the RAW host token
 * (see `rawHostname`). Clean quads (e.g. 8.8.8.8, 192.168.1.1) return false and
 * are left to `validateHostUrl`; loopback/private literals still get rejected
 * there, and numeric-encoded forms (including loopback ones) are rejected here.
 */
function isNumericEncodedHost(h: string): boolean {
  // Standard dotted-decimal IPv4 quad — let validateHostUrl classify it.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false

  // Bare integer forms.
  if (/^0x[\da-f]+$/i.test(h)) return true // hex, e.g. 0x7f000001
  if (/^\d+$/.test(h)) return true // decimal, e.g. 2130706433

  // Dotted forms whose every part is numeric/hex but which are NOT a clean
  // decimal quad (short forms like 127.1, octal 0177.0.0.1, hex 0x7f.0.0.1).
  const parts = h.split('.')
  if (parts.length >= 2 && parts.every((p) => /^(0x[\da-f]+|\d+)$/i.test(p))) {
    return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Name sanitisation
// ---------------------------------------------------------------------------

/**
 * Sanitise a server name into a safe tool key segment.
 * Output: lowercase [a-z0-9_], max 20 chars, never empty.
 */
export function sanitizeServerName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20)
  return cleaned || 'server'
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/**
 * Connect to a list of custom MCP servers, returning merged AI SDK tools and
 * per-server statuses.
 *
 * Each tool key is prefixed as `mcp_<sanitizedServerName>_<toolName>` so it
 * cannot collide with built-in agent tools.
 *
 * At most MAX_SERVERS (5) servers are connected; extras are recorded as errors.
 * Per-server failures are isolated — one bad server does not affect others.
 */
export async function connectCustomMcpServers(
  servers: CustomMcpServerInput[],
  opts?: ConnectOptions
): Promise<McpConnectionResult> {
  const createClient = opts?.createClient ?? defaultCreateMcpClient
  const clients: Array<{ close: () => Promise<void> }> = []
  const allTools: Record<string, unknown> = {}
  const statuses: McpConnectionResult['statuses'] = []

  const toConnect = servers.slice(0, MAX_SERVERS)

  for (const server of toConnect) {
    if (!(await isAllowedMcpUrl(server.endpoint, opts?.resolveHostAddresses))) {
      statuses.push({
        id: server.id,
        status: 'error',
        toolCount: 0,
        error:
          'Endpoint URL not allowed (use https:, or http:// for localhost only)',
      })
      continue
    }

    try {
      const { client, tools } = await connectWithTimeout(server, createClient)
      clients.push(client)

      const prefix = `mcp_${sanitizeServerName(server.name)}_`
      for (const [toolName, tool] of Object.entries(tools)) {
        allTools[`${prefix}${toolName}`] = tool
      }

      statuses.push({
        id: server.id,
        status: 'connected',
        toolCount: Object.keys(tools).length,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      statuses.push({
        id: server.id,
        status: 'error',
        toolCount: 0,
        error: msg.slice(0, 200),
      })
    }
  }

  // Record any servers that were silently capped
  for (const server of servers.slice(MAX_SERVERS)) {
    statuses.push({
      id: server.id,
      status: 'error',
      toolCount: 0,
      error: `Skipped: maximum of ${MAX_SERVERS} custom servers per request`,
    })
  }

  const closeAll = async () => {
    await Promise.allSettled(clients.map((c) => c.close()))
  }

  return { tools: allTools, closeAll, statuses }
}

// ---------------------------------------------------------------------------
// Validate (test-before-save) + per-user loading
// ---------------------------------------------------------------------------

/**
 * Test-connect to a single MCP endpoint WITHOUT persisting: SSRF-guard the URL,
 * open the (SSRF-pinned) client, list its advertised tools, and ALWAYS close
 * the client — on success AND on throw (the BUG-03 close-always invariant).
 * Returns the real advertised tool names on success, or a reason on failure.
 */
export async function validateServer(
  input: CustomMcpServerInput,
  opts?: ConnectOptions
): Promise<{ ok: boolean; tools?: string[]; error?: string }> {
  if (!(await isAllowedMcpUrl(input.endpoint, opts?.resolveHostAddresses))) {
    return {
      ok: false,
      error:
        'Endpoint URL not allowed (use https:, or http:// for localhost only)',
    }
  }

  const createClient = opts?.createClient ?? defaultCreateMcpClient
  let client: McpClientLike | null = null
  try {
    const result = await connectWithTimeout(input, createClient)
    client = result.client
    return { ok: true, tools: Object.keys(result.tools) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg.slice(0, 200) }
  } finally {
    // Close whether tools() succeeded or the connect threw after opening.
    if (client) await client.close().catch(() => {})
  }
}

/**
 * Resolve a user's ENABLED, D1-persisted registrations into connect inputs
 * (decrypted server-side). Best-effort: any failure (no D1 binding on
 * self-hosted, decrypt error) resolves to `[]` so the conversation still runs
 * with built-in tools — never throws into the agent request.
 */
export async function loadUserRegisteredServers(
  userId: string,
  opts?: { store?: Pick<McpRegistrationStore, 'listEnabledConnectInputs'> }
): Promise<CustomMcpServerInput[]> {
  // Self-hosted/OSS without a D1 binding has no registry — skip silently. A
  // missing registry is a normal condition, not an error worth logging on every
  // agent conversation. Tests inject a store, so they bypass this gate.
  if (!opts?.store && !isMcpRegistryEnabled()) return []
  try {
    const store = opts?.store ?? mcpRegistrationStore
    const inputs = await store.listEnabledConnectInputs(userId)
    return inputs.map(connectInputToCustomServer)
  } catch (e) {
    console.error('[mcp-registry] loadUserRegisteredServers failed:', e)
    return []
  }
}

function connectInputToCustomServer(
  input: McpConnectInput
): CustomMcpServerInput {
  return {
    id: input.id,
    name: input.name,
    endpoint: input.url,
    transport: input.transport,
    auth: input.auth,
  }
}

/**
 * Merge multiple custom-server lists into one, de-duplicated by normalized
 * endpoint (earlier lists win). Prevents connecting the same endpoint twice —
 * and blowing past the per-call cap / colliding tool keys — when a user's
 * request carries both request-body servers and their D1 registrations.
 */
export function mergeMcpServers(
  ...lists: CustomMcpServerInput[][]
): CustomMcpServerInput[] {
  const seen = new Set<string>()
  const merged: CustomMcpServerInput[] = []
  for (const list of lists) {
    for (const server of list) {
      const key = normalizeEndpoint(server.endpoint)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(server)
    }
  }
  return merged
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().toLowerCase()
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Build outbound auth headers from a registration's structured auth. Returns
 * undefined for no auth so the transport sends none.
 */
function buildAuthHeaders(auth?: McpAuth): Record<string, string> | undefined {
  if (!auth || auth.kind === 'none') return undefined
  if (auth.kind === 'bearer') return { Authorization: `Bearer ${auth.token}` }
  return { [auth.headerName]: auth.value }
}

/**
 * Default MCP client factory: opens a real AI SDK client over the requested
 * transport, PINNED behind the shared host-validation fetch. This closes SEC-04
 * — the actual outbound connection is validated the same way the pre-check is,
 * defeating the DNS-rebind TOCTOU (identical posture to `connection-client.ts`
 * for user-supplied ClickHouse hosts: pins on Node, IP-literal-only on Workers).
 */
const defaultCreateMcpClient: McpClientFactory = async ({
  url,
  transport,
  headers,
  serverName,
}) => {
  const client = await createMCPClient({
    transport: {
      type: transport,
      url,
      ...(headers ? { headers } : {}),
      fetch: createHostValidationFetch(),
    },
    onUncaughtError: (e) => {
      console.error(`[MCP] Uncaught error from "${serverName}":`, e)
    },
  })
  return {
    tools: () => client.tools() as Promise<Record<string, unknown>>,
    close: () => client.close(),
  }
}

/**
 * Connect to an MCP endpoint and fetch its tools, with a hard timeout.
 * Cleans up the client if the timeout fires OR if tools() throws after the
 * client opened, so a failed listing never leaks an open connection.
 */
async function connectWithTimeout(
  server: CustomMcpServerInput,
  createClient: McpClientFactory
): Promise<{
  client: McpClientLike
  tools: Record<string, unknown>
}> {
  let settled = false
  let resolvedClient: McpClientLike | null = null

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      // Clean up any client that connected but whose tools() call timed out
      if (resolvedClient) {
        resolvedClient.close().catch(() => {})
      }
      reject(new Error(`MCP connect timed out after ${CONNECT_TIMEOUT_MS}ms`))
    }, CONNECT_TIMEOUT_MS)

    ;(async () => {
      try {
        const client = await createClient({
          url: server.endpoint,
          transport: server.transport ?? 'http',
          headers: buildAuthHeaders(server.auth),
          serverName: server.name,
        })
        resolvedClient = client
        const tools = await client.tools()

        if (settled) {
          // Timed out while awaiting tools(); close the orphaned client
          client.close().catch(() => {})
          return
        }

        settled = true
        clearTimeout(timer)
        resolve({ client, tools: tools as Record<string, unknown> })
      } catch (e) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // If the client opened but tools() threw, close it before rejecting so
        // a failed listing never leaks an open connection (BUG-03 class).
        if (resolvedClient) {
          resolvedClient.close().catch(() => {})
        }
        reject(e)
      }
    })()
  })
}
