/**
 * Cloudflare Cache API (`caches.default`) wrapper for anonymous public-read
 * GET responses (#2181).
 *
 * Cloudflare Workers do NOT automatically populate a shared edge cache from a
 * `Cache-Control: s-maxage=...` response header alone — that only advises
 * downstream HTTP caches (browser / any zone-level Cache Rule in front of the
 * Worker). Without explicitly reading/writing `caches.default`, every
 * anonymous viewer of the shared public demo host re-runs the same
 * ClickHouse query and Worker invocation. This module lets a route opt into
 * `caches.default` for the one case where it's safe: an anonymous request on
 * a deployment that has opted into public read access.
 *
 * SAFETY INVARIANT — READ BEFORE CHANGING:
 * `caches.default` is a SINGLE cache shared by every request the Worker ever
 * serves; it has no per-user partition. Writing an authenticated or
 * per-user response into it would leak that response to the next visitor who
 * happens to produce the same cache key — a genuine cross-user data leak, not
 * a hypothetical one. `isEdgeCacheEligible` is therefore the ONLY gate: it is
 * `true` if and only if the request is anonymous AND the deployment has
 * opted into public read (`publicReadEnabled()`), via
 * `isAnonymousPublicReadRequest` in `@/lib/feature-permissions/server` (the
 * same auth resolution `authorizeFeatureRequest` uses, so this can never
 * disagree with the per-feature access gate). Callers MUST check this before
 * every `matchEdgeCache` / `putEdgeCache` call and MUST NOT cache a response
 * for any request where it returns `false`.
 */

import { isAnonymousPublicReadRequest } from '@/lib/feature-permissions/server'

/**
 * The dashboard's `tsconfig.json` `types` resolves `CacheStorage` from the DOM
 * lib (shared with the browser bundle), which has no `default` property — only
 * the Workers-runtime `CacheStorage` does. Cast through this narrow local
 * shape instead of widening the global type for the whole app.
 */
interface WorkersCacheStorage {
  readonly default: Cache
}

/**
 * `caches.default` is a Workers-runtime global. It does not exist under
 * `bun test` / plain Node, so callers fall back to "no edge cache" rather
 * than throwing — under-caching (a ClickHouse round trip on every request) is
 * the safe failure mode, never over-caching.
 */
function getDefaultCache(): Cache | undefined {
  if (typeof caches === 'undefined') return undefined
  return (caches as unknown as WorkersCacheStorage).default
}

/**
 * Whether this request may read from / write to the shared edge cache.
 *
 * See the module doc comment — this is the ONE safety gate for
 * `matchEdgeCache` / `putEdgeCache`. Never call `putEdgeCache` (or serve a
 * `matchEdgeCache` hit) for a request where this returns `false`.
 */
export function isEdgeCacheEligible(request: Request): Promise<boolean> {
  return isAnonymousPublicReadRequest(request)
}

/**
 * Build a stable cache key for the shared edge cache from explicit,
 * already-validated parts (not the raw incoming `Request`, which may carry
 * cookies/Authorization headers and client-supplied query-param ordering that
 * have no bearing on the response body).
 *
 * `route` namespaces the key (e.g. `'charts'`) so different endpoints never
 * collide. Remaining parts are sorted by key and appended as a normalized
 * query string so equivalent requests (regardless of param order) share one
 * cache entry. `undefined` values are omitted.
 */
export function buildEdgeCacheKey(
  route: string,
  parts: Record<string, string | number | boolean | undefined>
): Request {
  const url = new URL(`https://edge-cache.internal/${route}`)
  for (const key of Object.keys(parts).sort()) {
    const value = parts[key]
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return new Request(url.toString())
}

/**
 * Look up `cacheKey` in the shared edge cache. Returns `undefined` on a miss
 * or when `caches.default` isn't available (e.g. tests).
 *
 * Callers MUST have already confirmed `isEdgeCacheEligible(request)` before
 * calling this — this function does not re-check it, so it must never be
 * called for an authenticated/per-user request.
 */
export async function matchEdgeCache(
  cacheKey: Request
): Promise<Response | undefined> {
  const cache = getDefaultCache()
  if (!cache) return undefined
  return cache.match(cacheKey)
}

/**
 * Store `response` in the shared edge cache under `cacheKey`.
 *
 * Only caches a plain 200 response that already carries an `s-maxage`
 * directive (i.e. a route that has deliberately opted into caching) — this
 * never expands caching to a response that wasn't already meant to be
 * cacheable. No-ops when `caches.default` is unavailable.
 *
 * Callers MUST have already confirmed `isEdgeCacheEligible(request)` before
 * calling this — this function does not re-check it, so it must never be
 * called for an authenticated/per-user request. Clones `response` internally,
 * so the caller's own `response` object remains safe to return to the client.
 */
export async function putEdgeCache(
  cacheKey: Request,
  response: Response
): Promise<void> {
  const cache = getDefaultCache()
  if (!cache) return
  if (response.status !== 200) return
  const cacheControl = response.headers.get('Cache-Control') ?? ''
  if (!/(?:^|,)\s*s-maxage=\d+/.test(cacheControl)) return
  await cache.put(cacheKey, response.clone())
}
