/**
 * Reachability probes for the agent's read-only integration tools.
 *
 * - Per-isolate cache: a success is reused for CHM_AGENT_INTEGRATION_PROBE_TTL_MS
 *   (default 60s), a failure for min(15s, TTL).
 * - Concurrent callers share one in-flight probe.
 * - Bounded: the caller waits at most CHM_AGENT_INTEGRATION_PROBE_TIMEOUT_MS
 *   (default 1500, which is also the cap). The budget RACES the probe rather
 *   than aborting it, so a slow probe still settles in the background and
 *   fills the cache for the next conversation. A budget miss is reported as
 *   `{ ok: false, kind: 'probe_timeout' }` — the chat is never blocked.
 * - Results carry a failure KIND only, never an error message: a PeerDB or
 *   Postgres error message can contain the host, URL userinfo, or DSN.
 */

import type { IntegrationName, Reachability } from './integration-tools-gate'

import { PeerDBError, readNonNegativeIntEnv } from '@/lib/peerdb/peerdb-config'

export const DEFAULT_PROBE_TIMEOUT_MS = 1500
export const DEFAULT_PROBE_TTL_MS = 60_000
export const MAX_FAILURE_TTL_MS = 15_000
/** An in-flight probe older than this is abandoned and re-run. */
export const MAX_INFLIGHT_AGE_MS = 15_000

export function probeTimeoutMs(): number {
  const v = readNonNegativeIntEnv(
    'CHM_AGENT_INTEGRATION_PROBE_TIMEOUT_MS',
    DEFAULT_PROBE_TIMEOUT_MS
  )
  // The design caps the probe budget at the default: a value can lower it,
  // never raise it.
  return Math.min(v, DEFAULT_PROBE_TIMEOUT_MS)
}

export function probeTtlMs(): number {
  return readNonNegativeIntEnv(
    'CHM_AGENT_INTEGRATION_PROBE_TTL_MS',
    DEFAULT_PROBE_TTL_MS
  )
}

const KIND_RE = /^[A-Za-z0-9_]{1,32}$/

/**
 * Reduce a probe error to a short, credential-free kind: the PeerDB failure
 * kind, else a Postgres SQLSTATE / node error code, else `error`.
 */
export function probeFailureKind(err: unknown): string {
  if (err instanceof PeerDBError && err.kind) return err.kind
  const code =
    typeof err === 'object' && err !== null
      ? (err as { code?: unknown }).code
      : undefined
  if (typeof code === 'string' && KIND_RE.test(code)) return code.toLowerCase()
  return 'error'
}

export interface ProbeCacheOptions {
  probes: Record<IntegrationName, () => Promise<unknown>>
  now?: () => number
  timeoutMs?: () => number
  ttlMs?: () => number
  setTimer?: (fn: () => void, ms: number) => () => void
}

export interface ProbeCache {
  check(name: IntegrationName): Promise<Reachability>
  clear(): void
}

export function createIntegrationProbeCache(
  options: ProbeCacheOptions
): ProbeCache {
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? probeTimeoutMs
  const ttlMs = options.ttlMs ?? probeTtlMs
  const setTimer =
    options.setTimer ??
    ((fn, ms) => {
      const t = setTimeout(fn, ms)
      return () => clearTimeout(t)
    })

  const entries = new Map<IntegrationName, { at: number; r: Reachability }>()
  const inflight = new Map<
    IntegrationName,
    { p: Promise<Reachability>; startedAt: number }
  >()

  function fresh(name: IntegrationName): Reachability | undefined {
    const e = entries.get(name)
    if (!e) return undefined
    const ttl = ttlMs()
    const limit = e.r.ok ? ttl : Math.min(MAX_FAILURE_TTL_MS, ttl)
    return now() - e.at < limit ? e.r : undefined
  }

  function run(name: IntegrationName): Promise<Reachability> {
    const existing = inflight.get(name)
    // A probe that never settles (e.g. its I/O was cancelled with the request
    // that started it) must not pin every later check to `probe_timeout`:
    // past MAX_INFLIGHT_AGE_MS it is replaced by a fresh probe.
    if (existing && now() - existing.startedAt < MAX_INFLIGHT_AGE_MS) {
      return existing.p
    }
    const p: Promise<Reachability> = Promise.resolve()
      .then(() => options.probes[name]())
      .then(
        (): Reachability => ({ ok: true }),
        (err): Reachability => ({ ok: false, kind: probeFailureKind(err) })
      )
      .then((r) => {
        // Only the current probe may write: a late, replaced probe must not
        // clobber a newer result.
        if (inflight.get(name)?.p === p) {
          entries.set(name, { at: now(), r })
          inflight.delete(name)
        }
        return r
      })
    inflight.set(name, { p, startedAt: now() })
    return p
  }

  return {
    async check(name) {
      const cached = fresh(name)
      if (cached) return cached
      const probe = run(name)
      let cancel: (() => void) | undefined
      const budget = new Promise<Reachability>((resolve) => {
        cancel = setTimer(
          () => resolve({ ok: false, kind: 'probe_timeout' }),
          timeoutMs()
        )
      })
      try {
        return await Promise.race([probe, budget])
      } finally {
        cancel?.()
      }
    },
    clear() {
      entries.clear()
      inflight.clear()
    },
  }
}

/** PeerDB: a cheap allowlisted read (the same path the UI proxy forwards). */
async function probePeerDB(): Promise<void> {
  const { peerdbFetch } = await import('@/lib/peerdb/peerdb-config')
  await peerdbFetch('/v1/peers/list')
}

/** Postgres: `SELECT 1` on the first source, through the read-only path. */
async function probePostgres(): Promise<void> {
  const { getAndValidatePostgresConfig, queryPostgres } = await import(
    '@chm/postgres-client'
  )
  await queryPostgres(getAndValidatePostgresConfig(0), 'SELECT 1')
}

export const integrationProbeCache = createIntegrationProbeCache({
  probes: { peerdb: probePeerDB, postgres: probePostgres },
})
