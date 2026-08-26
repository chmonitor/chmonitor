/**
 * Workers-compatible in-memory token bucket rate limiter.
 *
 * Design:
 * - Token bucket per (key, route) pair; state lives in-process (per-isolate).
 *   Cloudflare Workers isolates are short-lived, so this is a best-effort
 *   first pass. No Durable Objects required.
 * - Limits are env-configurable:
 *     RATE_LIMIT_AGENT_PER_MIN         (default 10)  — POST /api/v1/agent per signed-in identity
 *     RATE_LIMIT_AGENT_GUEST_PER_MIN   (default 5)   — POST /api/v1/agent per Cloud guest (see guest-ai.ts)
 *     RATE_LIMIT_API_PER_MIN           (default 100) — GET  data routes per IP
 *     RATE_LIMIT_MCP_PER_MIN           (default 30)  — /api/mcp per IP
 *     RATE_LIMIT_BROWSER_CONN_PER_MIN  (default 10)  — browser-connections test/sessions per IP
 * - Returns { allowed, retryAfterSec } so callers can build the 429 response.
 * - Safe for Workers: no Node-only APIs (no `process.hrtime`, no node timers).
 */

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the bucket refills enough for one more token. */
  retryAfterSec: number
  /** Remaining tokens in the bucket (informational). */
  remaining: number
}

interface Bucket {
  tokens: number
  lastRefillMs: number
}

/** Shared in-memory store. Lives for the lifetime of the isolate. */
const buckets = new Map<string, Bucket>()

/**
 * Hard cap on distinct bucket keys (e.g. distinct client IPs) kept in memory.
 * Without this, high-cardinality public traffic (scrapers, bot sweeps) would
 * grow `buckets` without bound for the isolate's lifetime.
 */
const MAX_BUCKETS = 5_000
/** Sweep every N calls rather than on every call — cheap amortized cost. */
const SWEEP_INTERVAL = 500
/** Buckets idle longer than this (10x the refill window) are stale. */
const STALE_MS = 600_000
let callsSinceSweep = 0

/**
 * Drop stale buckets and enforce the size cap (oldest-first). Map preserves
 * insertion order, and `checkRateLimit` re-inserts a key on every touch (see
 * below), so the oldest entries are also the least-recently-used ones.
 */
function pruneBuckets(nowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (nowMs - bucket.lastRefillMs >= STALE_MS) buckets.delete(key)
  }
  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value
    if (oldest === undefined) break
    buckets.delete(oldest)
  }
}

/**
 * Read a positive-integer env var; fall back to `defaultValue`.
 * Checking process.env is correct here — bridgeClickHouseEnv() copies Worker
 * bindings onto process.env before any API handler runs, so env vars are
 * available. We guard `typeof process !== 'undefined'` to be Workers-safe.
 */
function readIntEnv(key: string, defaultValue: number): number {
  if (typeof process === 'undefined') return defaultValue
  const raw = process.env[key]
  if (!raw) return defaultValue
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

/**
 * Check (and consume) one token from a token-bucket keyed by `bucketKey`.
 *
 * @param bucketKey  - Unique identifier (e.g. `agent:user:clerk_abc123`)
 * @param limitPerMin - Maximum requests allowed per 60-second window
 */
export function checkRateLimit(
  bucketKey: string,
  limitPerMin: number
): RateLimitResult {
  const nowMs = Date.now()
  const windowMs = 60_000 // 1 minute

  callsSinceSweep += 1
  if (callsSinceSweep >= SWEEP_INTERVAL) {
    callsSinceSweep = 0
    pruneBuckets(nowMs)
  }

  let bucket = buckets.get(bucketKey)
  if (!bucket) {
    bucket = { tokens: limitPerMin, lastRefillMs: nowMs }
  } else {
    // Re-insert to move this key to the end of Map iteration order, so
    // `pruneBuckets`'s oldest-first eviction approximates least-recently-used.
    buckets.delete(bucketKey)
  }
  buckets.set(bucketKey, bucket)

  // Refill tokens proportional to elapsed time
  const elapsedMs = nowMs - bucket.lastRefillMs
  if (elapsedMs > 0) {
    const refill = (elapsedMs / windowMs) * limitPerMin
    bucket.tokens = Math.min(limitPerMin, bucket.tokens + refill)
    bucket.lastRefillMs = nowMs
  }

  if (buckets.size > MAX_BUCKETS) pruneBuckets(nowMs)

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return {
      allowed: true,
      retryAfterSec: 0,
      remaining: Math.floor(bucket.tokens),
    }
  }

  // Compute how long until bucket has 1 token
  const msNeeded = ((1 - bucket.tokens) / limitPerMin) * windowMs
  const retryAfterSec = Math.ceil(msNeeded / 1000)

  return { allowed: false, retryAfterSec, remaining: 0 }
}

/**
 * Cloudflare Rate Limiting binding surface (the "unsafe" ratelimit binding).
 * `limit({ key })` resolves `{ success }` — success=false means the fleet-wide
 * counter for that key has exceeded the configured limit/period. This counter
 * lives in Cloudflare's edge (not the isolate), so it is enforced across every
 * isolate — unlike the in-memory `buckets` Map above.
 * @see https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/**
 * Cloudflare's rate-limit binding config uses a fixed `period` (10 or 60s).
 * The binding does not report a precise retry time, so blocked callers get a
 * conservative full-period backoff. Our declared bindings use a 60s period.
 */
const BINDING_PERIOD_SEC = 60

/**
 * Resolve a named Cloudflare rate-limit binding from the Worker runtime.
 *
 * Bindings are exposed on `globalThis` in the Worker (same detection pattern as
 * `CHM_DASHBOARD_QUERY_KV` / `CHM_VERSION_CACHE_KV` in
 * `lib/api/data/dashboard-query-kv-cache.ts`). Returns `undefined` on
 * Node/Docker/K8s (self-hosted) where no such binding exists, so callers fall
 * back to the in-memory limiter — preserving current OSS behaviour.
 */
export function getRateLimitBinding(
  name: string
): RateLimitBinding | undefined {
  if (typeof globalThis === 'undefined' || !(name in globalThis)) {
    return undefined
  }
  const candidate = (globalThis as Record<string, unknown>)[name]
  if (
    candidate &&
    typeof (candidate as RateLimitBinding).limit === 'function'
  ) {
    return candidate as RateLimitBinding
  }
  return undefined
}

/** Binding names declared in wrangler.toml (`[[unsafe.bindings]]`). */
export const RATE_LIMIT_BINDING_API = 'CHM_RATE_LIMIT_API'
export const RATE_LIMIT_BINDING_AGENT = 'CHM_RATE_LIMIT_AGENT'
export const RATE_LIMIT_BINDING_MCP = 'CHM_RATE_LIMIT_MCP'
export const RATE_LIMIT_BINDING_BROWSER_CONN = 'CHM_RATE_LIMIT_BROWSER_CONN'

/**
 * Fleet-wide rate limit check with graceful fallback.
 *
 * When a Cloudflare rate-limit binding named `bindingName` is present (Cloud /
 * Workers), the durable edge counter is authoritative — enforced across ALL
 * isolates (fixing the per-isolate blind spot of the in-memory Map). When the
 * binding is absent (self-hosted single-process Node/Docker/K8s) or errors,
 * this falls back to the in-memory `checkRateLimit` token bucket, so behaviour
 * is byte-identical to before on OSS deployments (fail-open to current).
 *
 * The `{ allowed, retryAfterSec, remaining }` contract is preserved; callers
 * only swap the sync call for an awaited one.
 *
 * @param bucketKey    - Unique identifier (e.g. `charts:ip:1.2.3.4`)
 * @param limitPerMin  - Fallback per-60s limit for the in-memory path
 * @param bindingName  - Worker binding to use when present (e.g. `CHM_RATE_LIMIT_API`)
 */
export async function checkRateLimitDurable(
  bucketKey: string,
  limitPerMin: number,
  bindingName: string
): Promise<RateLimitResult> {
  const binding = getRateLimitBinding(bindingName)
  if (binding) {
    try {
      const { success } = await binding.limit({ key: bucketKey })
      if (success) return { allowed: true, retryAfterSec: 0, remaining: 0 }
      return { allowed: false, retryAfterSec: BINDING_PERIOD_SEC, remaining: 0 }
    } catch {
      // Fail open to the in-memory limiter on any binding error, rather than
      // hard-blocking legitimate traffic when the edge counter is unavailable.
    }
  }
  return checkRateLimit(bucketKey, limitPerMin)
}

/**
 * Build the 429 response with Retry-After header.
 */
export function rateLimitResponse(retryAfterSec: number): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        type: 'rate_limited',
        message: `Too many requests. Retry after ${retryAfterSec} second(s).`,
        retryAfterSec,
      },
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSec),
      },
    }
  )
}

/**
 * Whether the request's `X-Real-IP` / `X-Forwarded-For` headers may be trusted
 * as the real client address.
 *
 * - Cloudflare's `CF-Connecting-IP` is ALWAYS trusted: it is set by the
 *   Workers platform itself and is overwritten (stripped of inbound values) by
 *   the edge, so it cannot be spoofed by a caller.
 * - `X-Real-IP` / `X-Forwarded-For` are client-supplied unless the operator's
 *   ingress proxy overwrites them (nginx "real_ip", Caddy `remote_ip`, etc.).
 *   On self-hosted deploys these headers are therefore spoofable, so trusting
 *   them lets a caller rotate headers per request to bypass IP-keyed limiters
 *   and, for Cloud guests, to mint a fresh `guest:<hash>` quota identity per
 *   request — the quota-bypass vector in issue #3225.
 *
 * Opt-in via `CHM_TRUST_PROXY_HEADERS=true` (or `=1`/`=cloud`). An explicit
 * `false`/`0` opts OUT (disables trusting even on the edge). When unset it
 * defaults to true ONLY when running on the Cloudflare Workers runtime, where
 * the edge sanitises those headers for us, and false otherwise
 * (Node/Docker/K8s self-host), so the OSS build is never weakened by trusting
 * client-supplied headers.
 *
 * Pass `runtimeEnv` (the Cloudflare `env` binding) to override the runtime
 * detection in tests; it defaults to `process.env` on Node.
 */
export function trustProxyHeaders(
  runtimeEnv?: Record<string, string | undefined>
): boolean {
  const source =
    runtimeEnv ?? (typeof process !== 'undefined' ? process.env : {})
  const explicit = parseBoolOrUndefined(source.CHM_TRUST_PROXY_HEADERS)
  if (explicit !== null) return explicit

  // Default: only trust proxy headers where the runtime is the Cloudflare
  // edge, which sets/strips them for us. Fail-closed to "don't trust" on every
  // other runtime (Node/Docker/K8s) so an unset header never weakens OSS.
  if (
    typeof source.CF_PAGES !== 'undefined' ||
    source.CLOUDFLARE_WORKERS === '1'
  ) {
    return true
  }
  return isCloudflareWorkersRuntime()
}

/**
 * Parse a boolean-like env value, returning null when unset/empty/junk so the
 * caller can apply a runtime-dependent default. Only the exact strings
 * 'true'/'1'/'cloud' (case-insensitive) are truthy; everything else ('false',
 * '0', 'no', junk) is false.
 */
function parseBoolOrUndefined(
  value: string | null | undefined
): boolean | null {
  if (value === undefined || value === null || value.trim() === '') return null
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'cloud'
}

/**
 * Detect the Cloudflare Workers runtime without importing server-only modules.
 * Mirrors `isCloudflareWorkers()` from `@chm/clickhouse-client` (we avoid that
 * import here to keep the rate-limiter dependency-free and SSR-safe): workerd
 * exposes the global `caches` API and lacks `process`.
 */
function isCloudflareWorkersRuntime(): boolean {
  if (typeof globalThis === 'undefined' || typeof process !== 'undefined') {
    return false
  }
  const g = globalThis as Record<string, unknown>
  return (
    typeof g.caches !== 'undefined' ||
    typeof g.DurableObject !== 'undefined' ||
    typeof g.WebSocketPair !== 'undefined'
  )
}

/**
 * Extract a stable client identity key from a request.
 *
 * `CF-Connecting-IP` (set by the Cloudflare Workers platform) is always
 * trusted. `X-Real-IP` / `X-Forwarded-For` are only consulted when
 * `trustProxyHeaders()` is true — otherwise a client can rotate them per request
 * to bypass IP-keyed limiters and (for Cloud guests) reset the daily quota
 * identity. See `trustProxyHeaders` for the default policy.
 *
 * @param request  The incoming request.
 * @param runtimeEnv Optional env override (the Cloudflare `env` binding) for
 * runtime detection / `CHM_TRUST_PROXY_HEADERS`. Pass only in tests.
 */
export function clientIpKey(
  request: Request,
  runtimeEnv?: Record<string, string | undefined>
): string {
  const trusted = trustProxyHeaders(runtimeEnv)
  return (
    request.headers.get('cf-connecting-ip') ??
    (trusted ? request.headers.get('x-real-ip') : null) ??
    (trusted
      ? (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ||
        null
      : null) ??
    'unknown'
  )
}

/**
 * Rate limit config resolved from env.
 * Lazily read so bridgeClickHouseEnv() has already run by the time it's used.
 */
export function getAgentRateLimitPerMin(): number {
  return readIntEnv('RATE_LIMIT_AGENT_PER_MIN', 10)
}

export function getApiRateLimitPerMin(): number {
  return readIntEnv('RATE_LIMIT_API_PER_MIN', 100)
}

/**
 * /api/mcp exposes the same class of capability as the agent's SQL-executing
 * route (arbitrary read-only SQL via the `query` tool, plus 10 other
 * ClickHouse-querying tools) over a differently-authenticated transport —
 * see issue #2704. Default sits between the agent's per-turn budget (10,
 * expensive multi-tool LLM turns) and the plain data-route budget (100,
 * cheap single reads): a single MCP `tools/call` is one ClickHouse query,
 * comparable in cost to one agent tool call.
 */
export function getMcpRateLimitPerMin(): number {
  return readIntEnv('RATE_LIMIT_MCP_PER_MIN', 30)
}

/**
 * `/api/v1/browser-connections/{test,sessions}` are unauthenticated routes
 * that dial an attacker-supplied host on every request (#2978) — SSRF-guarded
 * against private targets, but otherwise an unauthenticated outbound-connection
 * oracle against public hosts (port/host scanning, credential stuffing relayed
 * through our egress IP). A human clicking "Test connection" issues single-digit
 * requests per minute, so 10/min per IP is generous for real usage while cutting
 * off automated abuse. Enforced via the dedicated `CHM_RATE_LIMIT_BROWSER_CONN`
 * binding on Workers (this getter's default only backs the in-memory fallback
 * used when that binding is absent, e.g. self-hosted) — kept separate from
 * `CHM_RATE_LIMIT_API`, whose 100/min edge threshold is sized for cheap GET data
 * routes and would be far too loose for a route that dials out. Both
 * browser-connections routes share this ONE binding + getter but use distinct
 * bucket-key prefixes (`browser-conn-test:ip:` / `browser-conn-sessions:ip:`) so
 * a burst against one doesn't consume the other's budget.
 */
export function getBrowserConnectionRateLimitPerMin(): number {
  return readIntEnv('RATE_LIMIT_BROWSER_CONN_PER_MIN', 10)
}

/**
 * RFC 8628 device-code endpoints (`/auth/device/code`, `/auth/token`) are
 * deliberately public. Cap code minting per IP to limit D1/memory write
 * amplification from unauthenticated callers.
 */
export function getDeviceCodeRateLimitPerMin(): number {
  return readIntEnv('RATE_LIMIT_DEVICE_CODE_PER_MIN', 10)
}

export const RATE_LIMIT_BINDING_DEVICE_CODE = 'CHM_RATE_LIMIT_DEVICE_CODE'

/**
 * Flush all buckets (for testing only).
 */
export function _resetBucketsForTest(): void {
  buckets.clear()
  callsSinceSweep = 0
}

/** Current number of distinct bucket keys held in memory (for testing only). */
export function _bucketCountForTest(): number {
  return buckets.size
}

/** The hard cap on distinct bucket keys (for testing only). */
export const _MAX_BUCKETS_FOR_TEST = MAX_BUCKETS
