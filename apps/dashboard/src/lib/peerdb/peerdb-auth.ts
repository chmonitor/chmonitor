/**
 * Workers-safe PeerDB auth + config resolution shared by the two proxy routes
 * (`api/v1/peerdb/$.ts`, `api/v1/peerdb-status.ts`) and the "Test PeerDB"
 * validation route.
 *
 * Pure and dependency-free — no node built-ins, no baked-in `process.env`
 * reads (callers pass the bindings / decrypted credentials) — so it runs
 * unchanged in the Cloudflare Workers runtime. `btoa` is available in every
 * Workers runtime, so no `Buffer` is needed for the Basic header.
 *
 * Two auth schemes are supported:
 * - `basic`  — the self-hosted default: HTTP Basic with an EMPTY username,
 *   `base64(':' + secret)`, matching the single-instance env behaviour.
 * - `bearer` — `Authorization: Bearer <token>`, for PeerDB Enterprise / BYOC
 *   deployments that sit behind an auth proxy.
 */

import type { ConnectionCredentials } from '@/lib/connection-store/types'

/**
 * Query-param name carrying the active PeerDB source connection id
 * (`?connection=<id>`). Client-safe home so both the browser hooks and the
 * server proxy share one literal.
 */
export const PEERDB_CONNECTION_PARAM = 'connection'

export type PeerDBAuthScheme = 'basic' | 'bearer'

export interface ResolvedPeerDBConfig {
  /** Flow-api base URL, trailing slashes stripped. */
  baseUrl: string
  /** Auth scheme; absent ⇒ no Authorization header (open flow-api). */
  authScheme?: PeerDBAuthScheme
  /** Basic password (empty-user) or Bearer token. Absent ⇒ open. */
  secret?: string
}

/** Narrow an arbitrary string to a known auth scheme (default `basic`). */
export function parsePeerDBAuthScheme(
  value: string | undefined | null
): PeerDBAuthScheme {
  return value?.trim().toLowerCase() === 'bearer' ? 'bearer' : 'basic'
}

/** Strip trailing slashes so `${baseUrl}${path}` never doubles a slash. */
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/**
 * Build the Authorization header for a resolved PeerDB config.
 * - `basic`: HTTP Basic with an EMPTY username — `base64(':' + secret)`.
 * - `bearer`: `Bearer <secret>`.
 * - no secret: no header (open flow-api).
 */
export function buildPeerDBAuthHeader(
  config: Pick<ResolvedPeerDBConfig, 'authScheme' | 'secret'>
): Record<string, string> {
  const secret = config.secret?.trim()
  if (!secret) return {}
  if (config.authScheme === 'bearer') {
    return { Authorization: `Bearer ${secret}` }
  }
  // basic (default): empty username → base64(":" + password)
  return { Authorization: `Basic ${btoa(`:${secret}`)}` }
}

/**
 * Resolve env-based PeerDB config from Worker bindings (or a `process.env`-like
 * record). Returns `null` when `PEERDB_API_URL` is unset — the not-configured
 * signal. `PEERDB_AUTH_SCHEME` (optional, default `basic`) lets an env
 * deployment behind an auth proxy send `PEERDB_PASSWORD` as a Bearer token.
 */
export function envPeerDBConfig(
  bindings: Record<string, string | undefined>
): ResolvedPeerDBConfig | null {
  const baseUrl = bindings.PEERDB_API_URL?.trim()
  if (!baseUrl) return null
  const secret = bindings.PEERDB_PASSWORD?.trim() || undefined
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    authScheme: secret
      ? parsePeerDBAuthScheme(bindings.PEERDB_AUTH_SCHEME)
      : undefined,
    secret,
  }
}

/**
 * Resolve PeerDB config from a stored connection credential envelope. Returns
 * `null` when the connection has no PeerDB monitoring link (`peerdbApiUrl`
 * unset).
 */
export function peerdbConfigFromCredentials(
  creds: Pick<
    ConnectionCredentials,
    'peerdbApiUrl' | 'peerdbAuthScheme' | 'peerdbAuthSecret'
  >
): ResolvedPeerDBConfig | null {
  const baseUrl = creds.peerdbApiUrl?.trim()
  if (!baseUrl) return null
  const secret = creds.peerdbAuthSecret?.trim() || undefined
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    authScheme: secret
      ? parsePeerDBAuthScheme(creds.peerdbAuthScheme)
      : undefined,
    secret,
  }
}

/**
 * Validate + shape the optional PeerDB credential fields from a create/update
 * request body. Pure and synchronous — the URL's http(s)/SSRF check is the
 * route's job (via `validateHostUrl`); this only vets the auth scheme and
 * decides which fields to persist:
 * - no `apiUrl` ⇒ no PeerDB fields (nothing to store / clears the link).
 * - `apiUrl` + no secret ⇒ URL only (open flow-api).
 * - `apiUrl` + secret ⇒ URL + scheme (default `basic`) + secret.
 */
export function buildPeerdbCredentialFields(input: {
  apiUrl?: string
  scheme?: string
  secret?: string
}): {
  error?: string
  fields: Pick<
    ConnectionCredentials,
    'peerdbApiUrl' | 'peerdbAuthScheme' | 'peerdbAuthSecret'
  >
} {
  const apiUrl = input.apiUrl?.trim()
  if (!apiUrl) return { fields: {} }
  if (
    input.scheme !== undefined &&
    input.scheme !== 'basic' &&
    input.scheme !== 'bearer'
  ) {
    return { error: 'peerdbAuthScheme must be "basic" or "bearer"', fields: {} }
  }
  const secret =
    typeof input.secret === 'string' && input.secret.length > 0
      ? input.secret
      : undefined
  return {
    fields: {
      peerdbApiUrl: apiUrl,
      ...(secret
        ? {
            peerdbAuthScheme: (input.scheme as PeerDBAuthScheme) ?? 'basic',
            peerdbAuthSecret: secret,
          }
        : {}),
    },
  }
}

/**
 * Pure source-selection: which PeerDB config a request should use.
 *
 * - An explicit `?connection=<id>` selects THAT connection's config (or `null`
 *   when it has no PeerDB link / isn't resolvable — the caller then reports
 *   not-configured; the env config is never used as a silent fallback for an
 *   explicit connection, so one user's env can't leak into another's request).
 * - No selector ⇒ the env config (fallback, zero regression from today).
 */
export function selectPeerDBSource(args: {
  connectionId?: string | null
  connectionConfig: ResolvedPeerDBConfig | null
  envConfig: ResolvedPeerDBConfig | null
}): ResolvedPeerDBConfig | null {
  if (args.connectionId) return args.connectionConfig
  return args.envConfig
}
