/**
 * OAuth discovery metadata for MCP clients (RFC 9728 Protected Resource
 * Metadata). Clerk is the authorization server — it hosts login, consent, and
 * dynamic client registration. We are only the resource server, so all we have
 * to publish is "which authorization server protects this resource"; the MCP
 * client takes it from there (OAuth 2.1 + PKCE against Clerk), then calls
 * /api/mcp with the bearer token we verify in verifyClerkOAuthToken.
 *
 * SDK-free on purpose (only imports ../cors + ./clerk-oauth) so the dashboard's
 * /.well-known route can serve metadata WITHOUT pulling @modelcontextprotocol/server
 * + createMcpServer into the dashboard worker bundle.
 */

import { withCors } from '../cors'
import { clerkOAuthEnabled } from './clerk-oauth'

/** The protected resource is the MCP endpoint, not the bare origin (RFC 9728). */
export const MCP_ENDPOINT_PATH = '/api/mcp'

/** Path MCP clients fetch for resource metadata (RFC 9728). */
export const PROTECTED_RESOURCE_METADATA_PATH =
  '/.well-known/oauth-protected-resource'

/** Default OAuth scopes the MCP server requests from Clerk. */
export const MCP_OAUTH_SCOPES = ['email', 'profile'] as const

/**
 * Clerk's authorization-server issuer = its Frontend API origin. The publishable
 * key base64-encodes that host: `pk_live_<base64("clerk.chmonitor.dev$")>`.
 * An explicit CLERK_OAUTH_ISSUER overrides the derivation (e.g. proxied domains).
 */
export function getClerkIssuer(): string | null {
  const explicit = process.env.CLERK_OAUTH_ISSUER
  if (explicit) return explicit.replace(/\/+$/, '')

  const pk =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
    process.env.CLERK_PUBLISHABLE_KEY
  if (!pk) return null

  const encoded = pk.replace(/^pk_(test|live)_/, '')
  let decoded: string
  try {
    decoded = atob(encoded)
  } catch {
    return null
  }
  const host = decoded.replace(/\$+$/, '')
  return host ? `https://${host}` : null
}

/**
 * True only when we can both VERIFY Clerk tokens (CLERK_SECRET_KEY) AND advertise
 * an issuer for discovery. Gating both the WWW-Authenticate challenge and the
 * metadata route on this single predicate keeps them consistent — we never point
 * a client at a 404 metadata URL, and never advertise a login flow whose tokens
 * we cannot verify.
 */
export function clerkOAuthDiscoverable(): boolean {
  return clerkOAuthEnabled() && getClerkIssuer() !== null
}

export interface ProtectedResourceMetadata {
  resource: string
  authorization_servers: string[]
  scopes_supported: string[]
  bearer_methods_supported: string[]
}

/**
 * Build the protected-resource metadata for the given resource identifier.
 * Returns null unless Clerk OAuth is fully discoverable (verifier + issuer).
 */
export function buildProtectedResourceMetadata(
  resource: string,
  scopes: readonly string[] = MCP_OAUTH_SCOPES
): ProtectedResourceMetadata | null {
  if (!clerkOAuthDiscoverable()) return null
  const issuer = getClerkIssuer()
  if (!issuer) return null
  return {
    resource: resource.replace(/\/+$/, ''),
    authorization_servers: [issuer],
    scopes_supported: [...scopes],
    bearer_methods_supported: ['header'],
  }
}

/**
 * WWW-Authenticate header value that points an unauthenticated MCP client at the
 * resource metadata, kicking off OAuth discovery (RFC 9728 §5.1).
 */
export function wwwAuthenticateHeader(resourceMetadataUrl: string): string {
  return `Bearer resource_metadata="${resourceMetadataUrl}"`
}

/**
 * Serve GET /.well-known/oauth-protected-resource (RFC 9728). Public by design —
 * discovery happens before the client has a token. The advertised `resource` is
 * the MCP endpoint on the request origin so RFC-9728 clients (which require the
 * returned resource to match the one they are accessing) accept it. Returns 404
 * when Clerk OAuth is not discoverable.
 */
export function handleProtectedResourceMetadata(req: Request): Response {
  const origin = new URL(req.url).origin
  const metadata = buildProtectedResourceMetadata(
    `${origin}${MCP_ENDPOINT_PATH}`
  )
  if (!metadata) {
    return withCors(new Response('Not Found', { status: 404 }))
  }
  return withCors(Response.json(metadata))
}
