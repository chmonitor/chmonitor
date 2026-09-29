/**
 * `CHM_CONFIG_FILE` loader for the feature-permission surface (#3494).
 *
 * Reads one TOML or YAML file (chosen by extension: `.toml`, else YAML) with a
 * `features` table and returns it as `FeatureOverrides`:
 *
 *   [features.agent]            features:
 *   enabled = true                agent:
 *   access = "authenticated"        enabled: true
 *                                   access: authenticated
 *
 * Precedence: built-in defaults < this file < env vars. Callers merge the env
 * overrides ON TOP of the result, so an explicit env var always wins.
 *
 * Fail-closed, modelled on `lib/query-config/declarative/local-loader.ts`:
 * pure, synchronous, never throws. An unset path, a missing/unreadable file,
 * or a runtime with no local filesystem (Cloudflare Workers) yields `{}` —
 * today's env-only behaviour. A malformed file or an invalid entry is pushed
 * onto `skipped[]` and warned; valid entries in the same file still apply.
 *
 * SERVER-ONLY MODULE: statically imports `node:fs` and the `yaml` parser.
 * Every call site MUST gate on the build-time `import.meta.env.SSR` constant
 * (not `typeof window`) so Vite dead-code-eliminates this import out of the
 * client bundle.
 *
 * TOML: the app ships no TOML parser and this change adds no dependency, so
 * `parseFeatureToml` accepts the subset the docs use — `[features.<id>]`
 * headers, `key = "string" | true | false`, and `#` comments. Anything else
 * is reported as a parse error (into `skipped[]`), never guessed at.
 */

import type { FeatureOverride, FeatureOverrides } from './types'

import { normalizeFeatureAccess, normalizeFeatureId } from './shared'
import fs from 'node:fs'
import { warn } from '@chm/logger'
import { parse as parseYaml } from 'yaml'

export interface LoadFeatureConfigFileResult {
  features: FeatureOverrides
  skipped: Array<{ entry: string; error: string }>
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Parse the documented TOML subset into `{ features: { <id>: {...} } }`. */
export function parseFeatureToml(raw: string): Record<string, unknown> {
  const features: Record<string, Record<string, unknown>> = {}
  let current: Record<string, unknown> | null = null

  raw.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.replace(/\s+#.*$/, '').trim()
    if (line === '' || line.startsWith('#')) return
    const lineNo = index + 1

    const header = /^\[\s*features\.([A-Za-z0-9_-]+)\s*\]$/.exec(line)
    if (header) {
      current = features[header[1]] ?? {}
      features[header[1]] = current
      return
    }
    if (line.startsWith('[')) {
      throw new Error(
        `line ${lineNo}: unsupported table "${line}" (only [features.<id>])`
      )
    }

    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line)
    if (!kv) throw new Error(`line ${lineNo}: expected key = value`)
    if (!current) {
      throw new Error(
        `line ${lineNo}: "${kv[1]}" is outside a [features.<id>] table`
      )
    }

    const value = kv[2].trim()
    if (value === 'true' || value === 'false') {
      current[kv[1]] = value === 'true'
    } else if (/^"[^"]*"$/.test(value) || /^'[^']*'$/.test(value)) {
      current[kv[1]] = value.slice(1, -1)
    } else {
      throw new Error(`line ${lineNo}: unsupported value ${value}`)
    }
  })

  return { features }
}

function toOverride(id: string, value: unknown): FeatureOverride {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`features.${id} must be a table`)
  }
  const override: FeatureOverride = {}
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'enabled') {
      if (typeof raw !== 'boolean') {
        throw new Error(`features.${id}.enabled must be true or false`)
      }
      override.enabled = raw
    } else if (key === 'access') {
      if (typeof raw !== 'string') {
        throw new Error(`features.${id}.access must be a string`)
      }
      override.access = normalizeFeatureAccess(raw)
    } else {
      throw new Error(`features.${id}.${key} is not a known key`)
    }
  }
  return override
}

/**
 * Read and validate the feature-permission config file at `filePath`.
 * Never throws; see the module comment for the fail-closed rules.
 */
export function loadFeatureConfigFile(
  filePath: string | undefined
): LoadFeatureConfigFileResult {
  const features: FeatureOverrides = {}
  const skipped: LoadFeatureConfigFileResult['skipped'] = []
  if (!filePath || filePath.trim() === '') return { features, skipped }

  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch {
    // Missing file, no permission, or no local filesystem (Workers):
    // silent no-op, the app keeps its env-only behaviour.
    return { features, skipped }
  }

  const skip = (entry: string, error: string) => {
    skipped.push({ entry, error })
    warn(`[feature-permissions] Skipping ${entry} in CHM_CONFIG_FILE`, {
      file: filePath,
      error,
    })
  }

  let parsed: unknown
  try {
    parsed = filePath.toLowerCase().endsWith('.toml')
      ? parseFeatureToml(raw)
      : parseYaml(raw)
  } catch (err) {
    skip('file', `Invalid config file: ${errorMessage(err)}`)
    return { features, skipped }
  }

  if (parsed === null || parsed === undefined) return { features, skipped }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    skip('file', 'Config file must be a mapping with a `features` table')
    return { features, skipped }
  }

  const table = (parsed as Record<string, unknown>).features
  if (table === undefined) return { features, skipped }
  if (table === null || typeof table !== 'object' || Array.isArray(table)) {
    skip('features', '`features` must be a table keyed by feature id')
    return { features, skipped }
  }

  for (const [key, value] of Object.entries(table)) {
    try {
      const id = normalizeFeatureId(key)
      if (features[id]) throw new Error(`duplicate feature id "${id}"`)
      features[id] = toOverride(id, value)
    } catch (err) {
      skip(`features.${key}`, errorMessage(err))
    }
  }

  return { features, skipped }
}

// Process-lifetime memo: read once per process, like queries.d. A pod restart
// picks up a changed ConfigMap.
let cached: FeatureOverrides | undefined

/** File overrides for `CHM_CONFIG_FILE` (read from `readEnv`), memoized. */
export function getFileFeatureOverrides(
  readEnv: (key: string) => string | undefined
): FeatureOverrides {
  if (cached) return cached
  cached = loadFeatureConfigFile(readEnv('CHM_CONFIG_FILE')).features
  return cached
}

/** Reset the memo — tests only. */
export function _resetFileFeatureOverridesCache(): void {
  cached = undefined
}
