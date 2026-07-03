/**
 * Community query-pack registry — Plan 54.
 *
 * `CHM_PACK_REGISTRY_URL` (comma-separated) points at one or more query packs
 * — HTTP(S) URLs or `file://` mounts — each a single YAML document shaped
 * like:
 *
 *   name: my-pack
 *   version: "1.0.0"
 *   minChmVersion: "0.3.0"   # optional; accepted, not yet enforced (v1)
 *   queries:
 *     - name: my-query
 *       sql: "SELECT 1"
 *       columns: [value]
 *
 * Packs are fetched once per process — startup-only, no hot-reload (v1; see
 * plan 54's open questions). Loading is gated on `CHM_CONFIG_SOURCE=declarative`
 * (packs extend the declarative catalog, same as the built-in one) and is a
 * no-op with zero I/O when no URLs are configured — the common/default case.
 *
 * SSRF: HTTP(S) fetches go through the shared `createHostValidationFetch`
 * (same primitive guarding ClickHouse Cloud connections, webhooks, and custom
 * MCP servers). `file://` reads bypass it deliberately — SSRF is a *network*
 * concern, and a `file://` pack is an operator-configured local path (same
 * trust model as `CHM_CONFIG_DIRECTORY` / queries.d, plan 55), not
 * attacker-controlled input.
 *
 * Fail-closed at every layer: an unreachable URL, invalid YAML, an invalid
 * manifest, or an invalid query entry is skipped with a `warn` log — the pack
 * (or just that entry) is dropped and the built-in catalog still serves. This
 * module never throws.
 *
 * Precedence (highest to lowest): local queries.d (plan 55) > packs (this
 * module) > built-in `DECLARATIVE_CATALOG` (plan 53) > TS `queries` array.
 * Within packs, later URLs in `CHM_PACK_REGISTRY_URL` win on a name
 * collision (logged); a later query within the same pack wins over an
 * earlier one too (same merge step).
 *
 * SERVER-ONLY MODULE: statically imports `node:fs/promises` + `node:url` (for
 * `file://`) and the `yaml` parser — none of which belong in the browser
 * bundle. Every call site MUST gate on the build-time `import.meta.env.SSR`
 * constant so Vite/Rollup dead-code-eliminates this whole module out of the
 * client build. See `getQueryConfigByName` in `../index.ts`.
 */

import { z } from 'zod'

import type { DeclarativeQueryConfig } from './schema'

import { getConfigSource } from './loader'
import { validateDeclarativeConfig } from './validate'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { error, warn } from '@chm/logger'
import { parse as parseYaml } from 'yaml'
import { createHostValidationFetch } from '@/lib/browser-connections/host-url'

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

/**
 * Parse `CHM_PACK_REGISTRY_URL` into a trimmed URL list, or `[]` when unset.
 * Pure — pass any env getter (mirrors `getConfigDirectory`'s runtimeEnv-first
 * convention).
 */
export function parsePackRegistryUrls(
  runtimeEnv?: Record<string, string | undefined>
): string[] {
  const source =
    runtimeEnv ?? (typeof process !== 'undefined' ? process.env : {})
  const raw = (source as Record<string, string | undefined>)
    .CHM_PACK_REGISTRY_URL
  if (!raw?.trim()) return []
  return raw
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Manifest schema
// ---------------------------------------------------------------------------

const packManifestSchema = z.object({
  name: z.string().min(1, 'pack name is required'),
  version: z.string().min(1, 'pack version is required'),
  // Minimum chmonitor version required to use this pack. Accepted and
  // schema-validated for forward-compatibility; not yet enforced against the
  // running app version (deferred — see plan 54's open questions).
  minChmVersion: z.string().min(1).optional(),
  queries: z.array(z.unknown()).min(1, 'pack must declare at least one query'),
})

// ---------------------------------------------------------------------------
// loadPacks — fetch, parse, validate, dedupe, merge
// ---------------------------------------------------------------------------

export interface LoadPacksResult {
  /** Deduped, name-keyed catalog — last writer (by URL/queries order) wins. */
  catalog: Record<string, DeclarativeQueryConfig>
  /** Every whole-pack or per-query rejection, with a human-readable reason. */
  skipped: Array<{ source: string; error: string }>
}

const PACK_FETCH_TIMEOUT_MS = 5000

/** Read one pack's raw YAML text — `file://` via disk, else via `fetchImpl`. */
async function readPackSource(
  url: string,
  fetchImpl: typeof fetch
): Promise<string> {
  if (url.startsWith('file://')) {
    return readFile(fileURLToPath(url), 'utf-8')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PACK_FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
    }
    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Fetch + validate every pack URL, merging valid queries into a single
 * name-keyed catalog. Never throws — every failure (fetch, YAML, manifest,
 * or a single query) is caught, logged via `warn`, and recorded in `skipped`;
 * the rest of the registry (and the built-in catalog) is unaffected.
 *
 * @param fetchImpl - SSRF-guarded by default (`createHostValidationFetch`).
 *   Tests inject a stub to stay hermetic (no real network/DNS).
 */
export async function loadPacks(
  urls: string[],
  fetchImpl: typeof fetch = createHostValidationFetch()
): Promise<LoadPacksResult> {
  const catalog: Record<string, DeclarativeQueryConfig> = {}
  const skipped: Array<{ source: string; error: string }> = []

  for (const url of urls) {
    let text: string
    try {
      text = await readPackSource(url, fetchImpl)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      skipped.push({ source: url, error: `Could not fetch pack: ${message}` })
      warn(`[query-config] Skipping pack "${url}": unreachable`, {
        error: message,
      })
      continue
    }

    let parsed: unknown
    try {
      parsed = parseYaml(text)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      skipped.push({ source: url, error: `Invalid YAML: ${message}` })
      warn(`[query-config] Skipping pack "${url}": invalid YAML`, {
        error: message,
      })
      continue
    }

    const manifestResult = packManifestSchema.safeParse(parsed)
    if (!manifestResult.success) {
      const message = manifestResult.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')
      skipped.push({ source: url, error: `Invalid pack manifest: ${message}` })
      warn(`[query-config] Skipping pack "${url}": invalid manifest`, {
        error: message,
      })
      continue
    }

    const manifest = manifestResult.data
    const packLabel = `${manifest.name}@${manifest.version}`

    for (const [index, entry] of manifest.queries.entries()) {
      const result = validateDeclarativeConfig(entry)
      if (!result.ok) {
        const message = result.errors.join('; ')
        skipped.push({
          source: `${url} (pack ${packLabel}, queries[${index}])`,
          error: message,
        })
        warn(
          `[query-config] Skipping queries[${index}] in pack "${packLabel}": schema validation failed`,
          { url, error: message }
        )
        continue
      }

      if (catalog[result.config.name]) {
        warn(
          `[query-config] Pack "${packLabel}" overrides existing query "${result.config.name}"`,
          { url }
        )
      }
      catalog[result.config.name] = result.config
    }
  }

  return { catalog, skipped }
}

// ---------------------------------------------------------------------------
// Process-lifetime memo — startup-only (v1), matching getLocalConfigCatalog's
// convention. Real callers (route handlers) `await ensurePacksLoaded` before
// the synchronous `getQueryConfigByName` lookup, so the catalog is guaranteed
// warm by the time it's read — no cold-start race.
// ---------------------------------------------------------------------------

let packCatalogSnapshot: Record<string, DeclarativeQueryConfig> = {}
let warmupPromise: Promise<Record<string, DeclarativeQueryConfig>> | undefined

/**
 * Ensure the pack catalog has been loaded, and return it. Memoized for the
 * process lifetime — the first call performs the fetch(es); every later call
 * (regardless of `runtimeEnv`) resolves immediately to the same result.
 *
 * A no-op (no I/O at all) when the declarative path isn't active or no pack
 * URLs are configured — keeps the OSS/`ts`-default path free.
 */
export function ensurePacksLoaded(
  runtimeEnv?: Record<string, string | undefined>
): Promise<Record<string, DeclarativeQueryConfig>> {
  if (warmupPromise) return warmupPromise

  if (getConfigSource(runtimeEnv) !== 'declarative') {
    warmupPromise = Promise.resolve(packCatalogSnapshot)
    return warmupPromise
  }

  const urls = parsePackRegistryUrls(runtimeEnv)
  if (urls.length === 0) {
    warmupPromise = Promise.resolve(packCatalogSnapshot)
    return warmupPromise
  }

  warmupPromise = loadPacks(urls)
    .then((result) => {
      packCatalogSnapshot = result.catalog
      return packCatalogSnapshot
    })
    .catch((err) => {
      // loadPacks already catches every per-URL failure; this is an extra
      // safety net so a truly unexpected throw can never surface as an
      // unhandled rejection or block the built-in catalog.
      error(
        '[query-config] Unexpected pack-registry failure; using built-in catalog',
        err
      )
      return packCatalogSnapshot
    })

  return warmupPromise
}

/** Synchronous read of whatever's currently cached (`{}` until warmed). */
export function getPackCatalogSnapshot(): Record<
  string,
  DeclarativeQueryConfig
> {
  return packCatalogSnapshot
}
