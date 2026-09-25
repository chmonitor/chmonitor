/**
 * Shared helpers for the agent's PeerDB tool.
 *
 * The agent never talks to PeerDB directly from the browser and never takes
 * an arbitrary URL from the model. All reads go through this ONE server-side
 * path: a fixed allowlist of read-only PeerDB REST paths (the same subset the
 * view-only UI proxy at `api/v1/peerdb/$.ts` forwards), with the
 * `PEERDB_PASSWORD` credential attached as an Authorization header and never
 * returned. Mirror names are the only model-controlled input and are
 * validated + encoded into a single path segment.
 *
 * Workers-safe: imports only the pure `peerdb-auth` module (no node
 * built-ins, `btoa`-based header). Env is read from `process.env` at call
 * time, matching the agent's existing convention (see tools/index.ts,
 * provider-chat-model.ts).
 */

import {
  buildPeerDBAuthHeader,
  envPeerDBConfig,
  type ResolvedPeerDBConfig,
} from '@/lib/peerdb/peerdb-auth'

const FETCH_TIMEOUT_MS = 10_000

/**
 * Explicit agent gate. Unlike the PeerDB UI section (which appears whenever
 * `PEERDB_API_URL` is set), the agent tool is opt-in — mirroring the
 * Postgres cross-source tools (`CHM_FEATURE_POSTGRES_SOURCE`) and the
 * control tools (`AGENT_ENABLE_CONTROL_TOOLS`). A URL-presence gate would
 * silently advertise PeerDB reads to the model on every deployment whose
 * operator only wanted the UI section. The feature kill-switch
 * (`CHM_FEATURE_PEERDB_ENABLED=false`) also keeps the tool out.
 */
export function isPeerDBAgentEnabled(): boolean {
  if (process.env.CHM_FEATURE_PEERDB_AGENT !== 'true') return false
  if (process.env.CHM_FEATURE_PEERDB_ENABLED === 'false') return false
  return true
}

/** Resolve the env-wide PeerDB config, or null when not configured. */
export function getPeerDBAgentConfig(): ResolvedPeerDBConfig | null {
  return envPeerDBConfig(process.env as Record<string, string | undefined>)
}

/**
 * Validate a model-supplied mirror (flow-job) name for safe interpolation
 * into a single upstream path segment. PeerDB flow names are operator-chosen
 * identifiers; reject anything that could escape the segment (slashes,
 * query/fragment delimiters, control chars) or blow up the URL.
 */
export function assertValidMirrorName(name: string): void {
  if (typeof name !== 'string' || name.length === 0 || name.length > 256) {
    throw new Error('mirrorName must be a non-empty string up to 256 chars')
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — reject control chars
  if (/[/?#\s\x00-\x1f\x7f]/.test(name)) {
    throw new Error(
      'mirrorName must be a plain mirror identifier (no slashes, query/fragment delimiters, whitespace, or control characters)'
    )
  }
}

export class PeerDBAgentError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'PeerDBAgentError'
  }
}

/**
 * Fixed-path read against the PeerDB REST API. `path` must be a full `/v1/...`
 * upstream path in the read-only proxy-allowlisted set (callers pass
 * literals, never model input). Throws `PeerDBAgentError` when PeerDB is
 * unconfigured or the upstream is non-2xx. Upstream host/secret never appear
 * in messages.
 */
export async function peerdbRequest<T = unknown>(
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown }
): Promise<T> {
  const config = getPeerDBAgentConfig()
  if (!config) {
    throw new PeerDBAgentError(
      'PeerDB is not configured on this deployment (PEERDB_API_URL is unset), so mirror status is unavailable.',
      503
    )
  }

  const url = `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      method: init?.method ?? 'GET',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...buildPeerDBAuthHeader(config),
      },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    throw new PeerDBAgentError(
      aborted
        ? `PeerDB request timed out after ${FETCH_TIMEOUT_MS}ms`
        : `Failed to reach PeerDB: ${err instanceof Error ? err.message : 'unknown error'}`,
      502
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new PeerDBAgentError(
      `PeerDB API error ${response.status}: ${response.statusText}`,
      response.status
    )
  }

  return (await response.json()) as T
}
