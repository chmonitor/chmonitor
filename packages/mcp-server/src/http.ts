/**
 * Runtime-agnostic HTTP glue for the MCP endpoint, shared by the dashboard route
 * and the standalone Cloudflare Worker. Auth is injectable so a caller can layer
 * Clerk OAuth on top of the default API-key check without this package taking a
 * Clerk dependency.
 */

import pkg from '../package.json'
import { apiKeyAuthEnabled, verifyApiKey } from './auth/api-key'
import { getBearerToken } from './auth/bearer-token'
import { clerkOAuthEnabled, verifyClerkOAuthToken } from './auth/clerk-oauth'
import {
  clerkOAuthDiscoverable,
  PROTECTED_RESOURCE_METADATA_PATH,
  wwwAuthenticateHeader,
} from './auth/oauth-metadata'
import { withCors } from './cors'
import {
  MCP_TOOLS,
  type McpResource,
  type McpToolCategory,
  type McpToolParam,
} from './data/mcp-tools-data'
import { createMcpServer } from './server'
import { createMcpHandler } from '@modelcontextprotocol/server'

export { handleProtectedResourceMetadata } from './auth/oauth-metadata'
export { corsPreflight, withCors } from './cors'

/** Workers Route patterns are exact-match, so /api/mcp/ must equal /api/mcp. */
export function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/, '')
  }
  return pathname
}

function unauthorized(req?: Request): Response {
  const headers = new Headers()
  // Only advertise discovery when it will actually work end to end (verifier +
  // issuer), so we never point a client at a metadata URL that would 404 or at a
  // login flow whose tokens we cannot verify.
  if (req && clerkOAuthDiscoverable()) {
    const metadataUrl = new URL(
      PROTECTED_RESOURCE_METADATA_PATH,
      new URL(req.url).origin
    ).toString()
    headers.set('WWW-Authenticate', wwwAuthenticateHeader(metadataUrl))
  }
  return withCors(new Response('Unauthorized', { status: 401, headers }))
}

/**
 * Only the Authorization bearer may be forwarded to Clerk's REST verifier — a
 * server-issued x-api-key must NEVER be relayed to a third party.
 */
function getRequestTokens(req: Request): {
  bearer: string | null
  apiKey: string | null
} {
  const bearer = getBearerToken(req.headers.get('authorization'))
  // Kept distinct: folding x-api-key into the bearer rejected `Bearer bad` + a
  // valid `x-api-key`.
  return { bearer, apiKey: req.headers.get('x-api-key') }
}

/** An API key may arrive via `x-api-key` or, by CLI convention, as a bearer. */
async function anyApiKeyValid(
  ...candidates: (string | null)[]
): Promise<boolean> {
  for (const candidate of candidates) {
    if (candidate && (await verifyApiKey(candidate)).valid) return true
  }
  return false
}

/** Returns a Response (denied) or null (allowed), so authenticators compose. */
export type Authenticator = (req: Request) => Promise<Response | null>

/** Allows everything when CHM_API_KEY_SECRET is unset. */
export const apiKeyAuthenticator: Authenticator = async (req) => {
  if (!apiKeyAuthEnabled()) return null
  const { bearer, apiKey } = getRequestTokens(req)
  return (await anyApiKeyValid(apiKey, bearer)) ? null : unauthorized(req)
}

/**
 * Default MCP authenticator — precedence: (API key | Clerk OAuth) → deny.
 *
 * - If NEITHER CHM_API_KEY_SECRET nor CLERK_SECRET_KEY is set, the endpoint
 *   returns 401 by default. Operators who intentionally want an open endpoint
 *   (trusted private networks) must set CHM_MCP_PUBLIC=true explicitly.
 * - When CHM_MCP_PUBLIC=true and no auth scheme is configured, a startup warning
 *   is logged on every request so operators cannot silently overlook the exposure.
 * - If EITHER auth scheme is configured, a token is required and accepted when it
 *   validates against ANY configured scheme. This lets API keys (CLI/headless)
 *   and Clerk OAuth (humans via MCP clients) coexist on the same endpoint.
 * - API key is checked first (local HMAC, no network); Clerk is a REST call, so
 *   it runs only if the API-key check did not already accept the credential.
 * - Only the Authorization bearer is forwarded to Clerk. An x-api-key is treated
 *   strictly as an API key and is never relayed to Clerk as an OAuth token.
 *
 * Clerk verification is a plain fetch (see verifyClerkOAuthToken), so this same
 * authenticator works in the Worker and the in-process route — no @clerk/nextjs.
 */
export const defaultAuthenticator: Authenticator = async (req) => {
  const apiKeyOn = apiKeyAuthEnabled()
  const clerkOn = clerkOAuthEnabled()
  if (!apiKeyOn && !clerkOn) {
    // Secure by default: deny unless the operator has explicitly opted in.
    if (process.env.CHM_MCP_PUBLIC !== 'true') return unauthorized(req)
    // Explicit opt-in: warn on every request so the exposure stays visible.
    console.warn(
      '[chm/mcp] WARNING: MCP endpoint is open to anonymous access ' +
        '(CHM_MCP_PUBLIC=true, no auth configured). ' +
        'Set CHM_API_KEY_SECRET or CLERK_SECRET_KEY to require authentication.'
    )
    return null
  }

  const { bearer, apiKey } = getRequestTokens(req)
  if (!bearer && !apiKey) return unauthorized(req)

  if (apiKeyOn && (await anyApiKeyValid(apiKey, bearer))) return null
  // Only the Authorization bearer is ever forwarded to Clerk — an x-api-key is a
  // server-issued credential and must never be relayed to a third party.
  if (clerkOn && bearer) {
    const result = await verifyClerkOAuthToken(bearer)
    if (result.valid) return null
  }
  return unauthorized(req)
}

/**
 * Returns a Response (rate limited) or null (allowed). Injected because
 * dependency-cruiser `no-packages-to-apps` forbids importing an app's limiter.
 */
export type RateLimitCheck = (req: Request) => Promise<Response | null>

interface HandleMcpOptions {
  authenticate?: Authenticator
  /** Runs before `authenticate`: cheap counter first, Clerk REST second. */
  rateLimitCheck?: RateLimitCheck
}

/**
 * `legacy: 'stateless'` serves both the 2026-07-28 protocol and a stateless
 * 2025-era fallback, so older MCP clients keep working. A fresh McpServer is
 * built per request; the handler itself is a singleton.
 */
const mcpHandler = createMcpHandler(() => createMcpServer(), {
  legacy: 'stateless',
})

/**
 * Auth and rate limiting run BEFORE the MCP handler, which performs no token
 * verification itself and gets no `authInfo` (tools are read-only).
 */
export async function handleMcp(
  req: Request,
  { authenticate = defaultAuthenticator, rateLimitCheck }: HandleMcpOptions = {}
): Promise<Response> {
  try {
    if (rateLimitCheck) {
      const limited = await rateLimitCheck(req)
      if (limited) return withCors(limited)
    }
    // withCors even on the auth failure: a custom authenticator may return a
    // bare Response, and browser MCP clients need the CORS headers to read it.
    const fail = await authenticate(req)
    if (fail) return withCors(fail)

    const res = await mcpHandler.fetch(req)
    return withCors(res)
  } catch {
    // An escaped rejection would surface as a CORS-less 500 (raw 1101 on Workers).
    return withCors(new Response('Internal Server Error', { status: 500 }))
  }
}

/** Subset of McpTool: omits `exampleResponse` to keep the payload small. */
interface McpToolSummary {
  name: string
  description: string
  category: McpToolCategory
  params: McpToolParam[]
}

export interface McpServerInfoResponse {
  name: string
  version: string
  description: string
  tools: McpToolSummary[]
  resources: McpResource[]
}

export function buildServerInfo(): McpServerInfoResponse {
  return {
    name: 'chmonitor',
    version: pkg.version,
    description: 'ClickHouse monitoring and query tools',
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      params: tool.params,
    })),
    resources: [
      {
        name: 'system-tables',
        uri: 'clickhouse://system-tables',
        description:
          'Reference of key ClickHouse system tables used for monitoring',
      },
      {
        name: 'query-examples',
        uri: 'clickhouse://query-examples',
        description:
          'Example SQL queries for common ClickHouse monitoring tasks',
      },
    ],
  }
}

/**
 * GET /api/v1/mcp/info with inline auth. The payload is static metadata (no
 * secrets), so deployments may serve it publicly with a no-op `authenticate`.
 */
export async function handleMcpInfo(
  req: Request,
  { authenticate = defaultAuthenticator, rateLimitCheck }: HandleMcpOptions = {}
): Promise<Response> {
  try {
    if (rateLimitCheck) {
      const limited = await rateLimitCheck(req)
      if (limited) return withCors(limited)
    }
    const fail = await authenticate(req)
    if (fail) return withCors(fail)
    return withCors(Response.json(buildServerInfo()))
  } catch {
    return withCors(new Response('Internal Server Error', { status: 500 }))
  }
}
