/**
 * Self-hosted local config override (queries.d) — Plan 55.
 *
 * At startup, scan `CHM_CONFIG_DIRECTORY` (default `/etc/chmonitor/queries.d`)
 * for `*.yaml` files, validate each against the declarative schema (plan 53),
 * and expose the valid ones as a name-keyed catalog — same shape as
 * DECLARATIVE_CATALOG — that `getQueryConfigByName` merges in ahead of the
 * built-in configs, so a local file can override a same-named built-in.
 *
 * Fail-closed: invalid files (bad YAML syntax, schema violations, or a
 * duplicate `name` within the directory) are skipped with a `warn` log — they
 * never crash or block boot. A missing/unreadable directory, or an
 * environment with no local filesystem at all (Cloudflare Workers), resolves
 * to an empty catalog with no log — that is the common case for most
 * self-hosted and all Cloud deploys.
 *
 * SERVER-ONLY MODULE: this file statically imports `node:fs` and the `yaml`
 * parser, neither of which belong in the browser bundle. Every call site MUST
 * gate on the build-time `import.meta.env.SSR` constant (not a runtime check
 * like `typeof window`) so Vite/Rollup dead-code-eliminates the whole branch
 * — and this import — out of the client build. See `getQueryConfigByName` in
 * `../index.ts`.
 */

import type { DeclarativeQueryConfig } from './schema'

import { validateDeclarativeConfig } from './validate'
import fs from 'node:fs'
import path from 'node:path'
import { warn } from '@chm/logger'
import { parse as parseYaml } from 'yaml'

const DEFAULT_CONFIG_DIRECTORY = '/etc/chmonitor/queries.d'

/**
 * Resolve the CHM_CONFIG_DIRECTORY env var (falls back to the default path).
 * Server-only; pass the Cloudflare Worker `env` binding or `process.env`
 * (mirrors `getConfigSource`'s runtimeEnv-first convention).
 */
export function getConfigDirectory(
  runtimeEnv?: Record<string, string | undefined>
): string {
  const source =
    runtimeEnv ?? (typeof process !== 'undefined' ? process.env : {})
  const value = (source as Record<string, string | undefined>)
    .CHM_CONFIG_DIRECTORY
  return value && value.trim() !== '' ? value : DEFAULT_CONFIG_DIRECTORY
}

export interface LoadLocalConfigsResult {
  loaded: DeclarativeQueryConfig[]
  skipped: Array<{ file: string; error: string }>
}

/**
 * Read every `*.yaml` file directly inside `dir`, validate it against the
 * declarative schema, and return the valid configs plus a skip list.
 *
 * Pure and synchronous — never throws. A missing directory, an unreadable
 * directory, or an environment with no local filesystem (Cloudflare Workers)
 * all resolve to `{ loaded: [], skipped: [] }`.
 */
export function loadLocalConfigs(dir: string): LoadLocalConfigsResult {
  const loaded: DeclarativeQueryConfig[] = []
  const skipped: Array<{ file: string; error: string }> = []

  let files: string[]
  try {
    files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
      .map((entry) => entry.name)
      .sort()
  } catch {
    // Missing directory, no permission, or no local filesystem at all
    // (Workers). Silent no-op — the app must always boot on defaults.
    return { loaded, skipped }
  }

  const seenNames = new Set<string>()

  for (const file of files) {
    const fullPath = path.join(dir, file)

    let raw: string
    try {
      raw = fs.readFileSync(fullPath, 'utf-8')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      skipped.push({ file, error: `Could not read file: ${message}` })
      warn(`[query-config] Skipping local config "${file}": unreadable`, {
        error: message,
      })
      continue
    }

    let parsed: unknown
    try {
      parsed = parseYaml(raw)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      skipped.push({ file, error: `Invalid YAML: ${message}` })
      warn(`[query-config] Skipping local config "${file}": invalid YAML`, {
        error: message,
      })
      continue
    }

    const result = validateDeclarativeConfig(parsed)
    if (!result.ok) {
      const message = result.errors.join('; ')
      skipped.push({ file, error: message })
      warn(
        `[query-config] Skipping local config "${file}": schema validation failed`,
        { error: message }
      )
      continue
    }

    if (seenNames.has(result.config.name)) {
      const message = `Duplicate name "${result.config.name}" in local config directory`
      skipped.push({ file, error: message })
      warn(`[query-config] Skipping local config "${file}": ${message}`)
      continue
    }

    seenNames.add(result.config.name)
    loaded.push(result.config)
  }

  return { loaded, skipped }
}

// ---------------------------------------------------------------------------
// Process-lifetime memo. "At startup, scan" — the directory is read once per
// process and cached, matching how self-hosted operators already expect a
// container/pod restart to pick up new or changed queries.d files.
// ---------------------------------------------------------------------------

let cachedCatalog: Record<string, DeclarativeQueryConfig> | undefined

/**
 * The local catalog, name-keyed like DECLARATIVE_CATALOG. Computed once per
 * process and memoized.
 */
export function getLocalConfigCatalog(
  runtimeEnv?: Record<string, string | undefined>
): Record<string, DeclarativeQueryConfig> {
  if (cachedCatalog) return cachedCatalog

  const { loaded } = loadLocalConfigs(getConfigDirectory(runtimeEnv))
  cachedCatalog = loaded.reduce<Record<string, DeclarativeQueryConfig>>(
    (acc, cfg) => {
      acc[cfg.name] = cfg
      return acc
    },
    {}
  )
  return cachedCatalog
}
