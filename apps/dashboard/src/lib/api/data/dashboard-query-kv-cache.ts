/**
 * Dashboard Query KV Cache (L2)
 *
 * Backs the in-memory per-isolate allowlist cache (`cache-manager.ts`, L1)
 * with an optional Cloudflare Workers KV layer that survives isolate churn
 * (cold starts, isolate eviction). Zero-config, same pattern as
 * `lib/version-cache.ts`'s `CHM_VERSION_CACHE_KV`: the code auto-detects the
 * `CHM_DASHBOARD_QUERY_KV` binding via `globalThis` and is a silent no-op when
 * it's absent — self-hosted Docker/K8s deploys (no Cloudflare KV) are
 * unaffected and keep working exactly as before.
 *
 * SECURITY (fail-closed): a KV miss, a KV read error, or a missing binding
 * ALWAYS returns `null`/no-op. Callers must treat that as "no cached
 * answer" and fall through to the authoritative ClickHouse allowlist query
 * in `dashboard-query-validator.ts` — never as permission to allow a query.
 * This module only ever *shortcuts an allow* on a positive, well-formed
 * cache hit; it never shortcuts a reject.
 *
 * @module lib/api/data/dashboard-query-kv-cache
 */

import { debug, warn } from '@chm/logger'
import { target } from '@/lib/target'

/** KV entry TTL: 15 minutes (longer than the 5-min in-memory L1, since KV
 * already survives isolate churn — this just bounds allowlist staleness). */
const KV_TTL_SECONDS = 15 * 60

function getKeyName(hostId: number): string {
  return `dashboard-queries:${hostId}`
}

/** Resolve the `CHM_DASHBOARD_QUERY_KV` binding if the runtime provides one. */
function getKV(): KVNamespace | undefined {
  const kv = target().kv('CHM_DASHBOARD_QUERY_KV')
  return kv ?? undefined
}

/**
 * Read the cached dashboard query allowlist for a host from KV.
 *
 * @returns The cached `Set` of queries, or `null` on any miss/error/absent
 * binding. `null` MUST be treated as "unknown" (fall through to the
 * authoritative ClickHouse check), never as "allowed" or "denied".
 */
export async function getKVCachedDashboardQueries(
  hostId: number
): Promise<Set<string> | null> {
  const kv = getKV()
  if (!kv) return null

  try {
    const value = await kv.get(getKeyName(hostId), { type: 'json' })
    if (!Array.isArray(value)) return null

    debug(`[dashboard-query-kv-cache] KV cache hit for host ${hostId}`)
    return new Set(value as string[])
  } catch (err) {
    // Fail closed: a KV read error is a cache miss, not an allow.
    warn(
      '[dashboard-query-kv-cache] KV get error (treated as cache miss):',
      err
    )
    return null
  }
}

/**
 * Write-through the freshly validated allowlist to KV. Best-effort: a write
 * failure is logged and swallowed — the caller already has its answer from
 * the authoritative ClickHouse query, so a KV write failure must never
 * affect the current request's result.
 */
export async function setKVCachedDashboardQueries(
  hostId: number,
  queries: Set<string>
): Promise<void> {
  const kv = getKV()
  if (!kv) return

  try {
    await kv.put(getKeyName(hostId), JSON.stringify(Array.from(queries)), {
      expirationTtl: KV_TTL_SECONDS,
    })
    debug(
      `[dashboard-query-kv-cache] KV cached ${queries.size} queries for host ${hostId}`
    )
  } catch (err) {
    warn('[dashboard-query-kv-cache] KV put error (non-fatal):', err)
  }
}
