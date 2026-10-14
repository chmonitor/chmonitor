/**
 * Reusable per-IP rate-limit check for MCP endpoints (#2728).
 *
 * The dashboard's in-process /api/mcp route gained an IP-keyed guard in #2704,
 * but the standalone Worker (apps/mcp) serves the same `handleMcp` and remained
 * unlimited — and this package cannot import the dashboard's limiter
 * (dependency-cruiser `no-packages-to-apps`, correctly). So `handleMcp` takes
 * an injectable `rateLimitCheck` (see http.ts), and this module provides a
 * dependency-free implementation callers can wire in.
 *
 * Semantics mirror `apps/dashboard/src/lib/api/rate-limiter.ts`:
 * - When a Cloudflare Rate Limiting binding (`[[unsafe.bindings]]` type
 *   "ratelimit") is present on `globalThis` under `bindingName`, its fleet-wide
 *   edge counter is authoritative.
 * - Otherwise a per-isolate token bucket enforces `limitPerMin` (covers
 *   `wrangler dev`, forks without the binding, and non-Workers runtimes).
 * - Binding errors fail open to the in-memory bucket rather than hard-blocking.
 */

/** Cloudflare Rate Limiting binding surface (the "unsafe" ratelimit binding). */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/** The bindings we declare use a 60s period; blocked callers back off a full one. */
const BINDING_PERIOD_SEC = 60
const WINDOW_MS = 60_000

interface Bucket {
  tokens: number
  lastRefillMs: number
}

/** Per-isolate fallback store; capped so hostile IP churn cannot grow it unbounded. */
const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 5_000

function getBinding(name: string): RateLimitBinding | undefined {
  const candidate = (globalThis as Record<string, unknown>)[name]
  if (
    candidate &&
    typeof (candidate as RateLimitBinding).limit === 'function'
  ) {
    return candidate as RateLimitBinding
  }
  return undefined
}

/**
 * Stable client identity: prefer Cloudflare's CF-Connecting-IP, fall back to
 * X-Real-IP, then the first X-Forwarded-For hop, then "unknown".
 */
export function clientIpKey(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    ((request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ||
      'unknown')
  )
}

/** In-memory token bucket; returns seconds to wait, or 0 when allowed. */
function checkBucket(key: string, limit: number): number {
  const nowMs = Date.now()
  let bucket = buckets.get(key)
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value
      if (oldest !== undefined) buckets.delete(oldest)
    }
    bucket = { tokens: limit, lastRefillMs: nowMs }
  } else {
    // Re-insert on touch so Map order approximates LRU for the cap eviction.
    buckets.delete(key)
  }
  buckets.set(key, bucket)

  const elapsedMs = nowMs - bucket.lastRefillMs
  if (elapsedMs > 0) {
    bucket.tokens = Math.min(
      limit,
      bucket.tokens + (elapsedMs / WINDOW_MS) * limit
    )
    bucket.lastRefillMs = nowMs
  }
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return 0
  }
  return Math.ceil((((1 - bucket.tokens) / limit) * WINDOW_MS) / 1000)
}

/** 429 with Retry-After — same JSON shape as the dashboard's rateLimitResponse. */
function rateLimitResponse(retryAfterSec: number): Response {
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

export interface IpRateLimitOptions {
  /**
   * Name of a Cloudflare rate-limit binding on `globalThis` (e.g.
   * "CHM_RATE_LIMIT_MCP"). When present it is authoritative; omit or absent →
   * in-memory bucket only.
   */
  bindingName?: string
  /**
   * Env var read (lazily, per request) for the in-memory limit. Junk or unset
   * values fall back to `defaultLimitPerMin`.
   */
  limitEnvVar?: string
  /** Fallback per-60s limit when the env var is unset/invalid. Default 30. */
  defaultLimitPerMin?: number
  /** Bucket-key namespace prefix. Default "mcp". */
  keyPrefix?: string
}

/**
 * Build a `rateLimitCheck` (see http.ts `HandleMcpOptions`) that limits by
 * client IP. Returns a 429 Response when over budget, null otherwise.
 */
export function createIpRateLimitCheck({
  bindingName,
  limitEnvVar = 'RATE_LIMIT_MCP_PER_MIN',
  defaultLimitPerMin = 30,
  keyPrefix = 'mcp',
}: IpRateLimitOptions = {}): (req: Request) => Promise<Response | null> {
  return async (request: Request) => {
    const key = `${keyPrefix}:ip:${clientIpKey(request)}`
    const binding = bindingName ? getBinding(bindingName) : undefined
    if (binding) {
      try {
        const { success } = await binding.limit({ key })
        return success ? null : rateLimitResponse(BINDING_PERIOD_SEC)
      } catch {
        // Fail open to the in-memory bucket rather than blocking legitimate
        // traffic when the edge counter is unavailable.
      }
    }
    // Read via globalThis so this stays type-clean under Workers-only tsconfigs
    // (apps/mcp has no Node types; nodejs_compat provides process at runtime).
    const raw = (
      globalThis as {
        process?: { env?: Record<string, string | undefined> }
      }
    ).process?.env?.[limitEnvVar]
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
    const limit =
      Number.isFinite(parsed) && parsed > 0 ? parsed : defaultLimitPerMin
    const retryAfterSec = checkBucket(key, limit)
    return retryAfterSec === 0 ? null : rateLimitResponse(retryAfterSec)
  }
}

/** Test-only: reset the fallback store between cases. */
export function _resetBucketsForTest(): void {
  buckets.clear()
}
