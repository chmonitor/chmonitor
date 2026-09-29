/**
 * Declarative health config loader (#3496) — modelled on
 * `lib/query-config/declarative/local-loader.ts`.
 *
 * Reads `CHM_HEALTH_CONFIG_DIRECTORY` (default `/etc/chmonitor/health.d`) and
 * the existing `HEALTH_*` env vars, and returns one tagged LAYER per source,
 * lowest precedence first (`env`, then `file`). It does not merge: resolution
 * (D1 > file > env > default, per key) belongs to the single merge helper in
 * #3497, so merge semantics are defined once rather than per store.
 *
 * Never throws. Bad YAML, unknown keys, schema violations, entries without a
 * merge key, and duplicate keys land in `skipped[]` with a `warn` log; the rest
 * of the file and the other files still load. A missing directory, or a
 * runtime with no local filesystem (Cloudflare Workers), is a silent no-op.
 * Logs name the file and entry only — never a field value, so a secret pasted
 * into a ConfigMap by mistake does not reach the logs.
 *
 * SERVER-ONLY MODULE: statically imports `node:fs` and the `yaml` parser.
 * Every call site MUST gate on the build-time `import.meta.env.SSR` constant
 * (not `typeof window`) so Vite dead-code-eliminates it from the client bundle.
 */

import type { z } from 'zod'

import type {
  HealthConfigConcern,
  HealthConfigData,
  HealthConfigEnvData,
  HealthConfigLayer,
  HealthConfigSkip,
} from './schema'

import { loadEnvCustomWebhookTargets } from '../custom-webhook-env'
import {
  getServerDigestWindowMinutes,
  getServerThresholdOverrides,
} from '../server-alert-config'
import {
  declarativeChannelSchema,
  declarativeCustomRuleSchema,
  declarativeMaintenanceWindowSchema,
  declarativeQuietHoursSchema,
  declarativeRouteSchema,
  declarativeThresholdSchema,
  declarativeWebhookTargetSchema,
  emptyHealthConfigData,
  HEALTH_CONFIG_CONCERNS,
  HEALTH_CONFIG_FILE_SCHEMAS,
} from './schema'
import fs from 'node:fs'
import path from 'node:path'
import { warn } from '@chm/logger'
import { parse as parseYaml } from 'yaml'

export const DEFAULT_HEALTH_CONFIG_DIRECTORY = '/etc/chmonitor/health.d'

/** Resolve `CHM_HEALTH_CONFIG_DIRECTORY` (runtime env first, then process). */
export function getHealthConfigDirectory(
  runtimeEnv?: Record<string, string | undefined>
): string {
  const source =
    runtimeEnv ?? (typeof process !== 'undefined' ? process.env : {})
  const value = source.CHM_HEALTH_CONFIG_DIRECTORY?.trim()
  return value ? value : DEFAULT_HEALTH_CONFIG_DIRECTORY
}

export interface LoadHealthConfigFilesResult {
  data: HealthConfigData
  /** Concerns whose file was present and at least parsed. */
  files: HealthConfigConcern[]
  skipped: HealthConfigSkip[]
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) =>
      i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message
    )
    .join('; ')
}

function skip(
  skipped: HealthConfigSkip[],
  file: string,
  error: string,
  entry?: string
): void {
  skipped.push(entry ? { file, entry, error } : { file, error })
  warn(
    `[health-config] Skipping ${entry ? `"${entry}" in ` : ''}"${file}": ${error}`
  )
}

/**
 * Validate a list entry-by-entry into a keyed record. An entry that fails its
 * schema (including a missing key) or repeats an earlier key is skipped.
 */
function collect<T>(
  items: unknown[],
  schema: z.ZodType<T>,
  keyOf: (value: T) => string,
  file: string,
  field: string,
  skipped: HealthConfigSkip[]
): Record<string, T> {
  const out: Record<string, T> = {}
  items.forEach((item, index) => {
    const entry = `${field}[${index}]`
    const result = schema.safeParse(item)
    if (!result.success) {
      skip(skipped, file, formatIssues(result.error), entry)
      return
    }
    const key = keyOf(result.data)
    if (Object.hasOwn(out, key)) {
      skip(skipped, file, `duplicate key "${key}"`, entry)
      return
    }
    out[key] = result.data
  })
  return out
}

function applyConcern(
  concern: HealthConfigConcern,
  parsed: unknown,
  file: string,
  data: HealthConfigData,
  skipped: HealthConfigSkip[]
): boolean {
  const envelope = HEALTH_CONFIG_FILE_SCHEMAS[concern].safeParse(parsed)
  if (!envelope.success) {
    skip(skipped, file, formatIssues(envelope.error))
    return false
  }
  const v = envelope.data
  switch (concern) {
    case 'alerts': {
      const { rules, thresholds } = v as {
        rules: unknown[]
        thresholds: Record<string, unknown>
      }
      data.customRules = collect(
        rules,
        declarativeCustomRuleSchema,
        (r) => r.id,
        file,
        'rules',
        skipped
      )
      for (const [rule, raw] of Object.entries(thresholds)) {
        const result = declarativeThresholdSchema.safeParse(raw)
        if (result.success) data.thresholds[rule] = result.data
        else
          skip(skipped, file, formatIssues(result.error), `thresholds.${rule}`)
      }
      break
    }
    case 'routing':
      data.routes = collect(
        (v as { routes: unknown[] }).routes,
        declarativeRouteSchema,
        (r) => r.id,
        file,
        'routes',
        skipped
      )
      break
    case 'channels': {
      const c = v as { channels: unknown[]; webhookTargets: unknown[] }
      data.channels = collect(
        c.channels,
        declarativeChannelSchema,
        (r) => r.channel,
        file,
        'channels',
        skipped
      )
      data.webhookTargets = collect(
        c.webhookTargets,
        declarativeWebhookTargetSchema,
        (r) => r.id,
        file,
        'webhookTargets',
        skipped
      )
      break
    }
    case 'quiet-hours':
      data.quietHours = collect(
        (v as { windows: unknown[] }).windows,
        declarativeQuietHoursSchema,
        (r) => r.id,
        file,
        'windows',
        skipped
      )
      break
    case 'maintenance':
      data.maintenanceWindows = collect(
        (v as { windows: unknown[] }).windows,
        declarativeMaintenanceWindowSchema,
        (r) => r.id,
        file,
        'windows',
        skipped
      )
      break
    case 'digest':
      data.digest = v as HealthConfigData['digest']
      break
  }
  return true
}

/**
 * Read the `<concern>.yaml` files directly inside `dir`. Pure, synchronous,
 * never throws. A missing/unreadable directory resolves to empty data.
 */
export function loadHealthConfigFiles(
  dir: string
): LoadHealthConfigFilesResult {
  const data = emptyHealthConfigData()
  const files: HealthConfigConcern[] = []
  const skipped: HealthConfigSkip[] = []

  let names: string[]
  try {
    names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml'))
      )
      .map((e) => e.name)
      .sort()
  } catch {
    // Missing directory or no local filesystem (Workers): boot on defaults.
    return { data, files, skipped }
  }

  const byConcern = new Map<string, string>()
  for (const name of names) {
    const concern = name.replace(/\.ya?ml$/, '')
    if (!(HEALTH_CONFIG_CONCERNS as readonly string[]).includes(concern)) {
      skip(
        skipped,
        name,
        `unknown file; expected one of ${HEALTH_CONFIG_CONCERNS.map((c) => `${c}.yaml`).join(', ')}`
      )
      continue
    }
    if (byConcern.has(concern)) {
      skip(skipped, name, `duplicate of "${byConcern.get(concern)}"`)
      continue
    }
    byConcern.set(concern, name)
  }

  for (const concern of HEALTH_CONFIG_CONCERNS) {
    const file = byConcern.get(concern)
    if (!file) continue

    let parsed: unknown
    try {
      parsed = parseYaml(fs.readFileSync(path.join(dir, file), 'utf-8'))
    } catch (err) {
      // YAML parser messages can quote source text; keep only the error class.
      const kind = err instanceof Error ? err.name : 'Error'
      skip(skipped, file, `unreadable or invalid YAML (${kind})`)
      continue
    }
    // An empty file is a no-op, not an error.
    if (parsed === null || parsed === undefined) continue
    if (applyConcern(concern, parsed, file, data, skipped)) files.push(concern)
  }

  return { data, files, skipped }
}

export interface HealthConfigEnvOptions {
  /** Rule ids to probe for `HEALTH_THRESHOLD_<RULE>_WARNING|CRITICAL`. */
  ruleIds?: readonly string[]
}

/**
 * The env layer, built from the existing parsers so env semantics stay
 * defined in one place: `getServerThresholdOverrides`,
 * `loadEnvCustomWebhookTargets` (`HEALTH_ALERT_WEBHOOK_TARGETS`), and
 * `getServerDigestWindowMinutes` (`HEALTH_ALERT_DIGEST_MINUTES`). Settings
 * with no env form yet stay empty.
 */
export function loadHealthConfigEnv(
  options: HealthConfigEnvOptions = {}
): HealthConfigEnvData {
  const env = typeof process !== 'undefined' ? process.env : {}
  const data: HealthConfigEnvData = {
    ...emptyHealthConfigData(),
    webhookTargets: {},
  }

  for (const [rule, override] of Object.entries(
    getServerThresholdOverrides(options.ruleIds ?? [])
  )) {
    data.thresholds[rule] = override
  }
  for (const target of loadEnvCustomWebhookTargets(env)) {
    data.webhookTargets[target.id] = target
  }
  if (env.HEALTH_ALERT_DIGEST_MINUTES?.trim()) {
    const windowMinutes = getServerDigestWindowMinutes()
    data.digest = { enabled: windowMinutes > 0, windowMinutes }
  }
  return data
}

export interface HealthConfigLayers {
  /** Lowest precedence first: `env`, then `file`. */
  layers: HealthConfigLayer[]
  skipped: HealthConfigSkip[]
}

// Process-lifetime memo of the file layer — the directory is read once per
// process, like `getLocalConfigCatalog`; a pod restart picks up changes. The
// env layer is cheap and depends on `ruleIds`, so it is rebuilt per call.
let cachedFiles:
  | { directory: string; result: LoadHealthConfigFilesResult }
  | undefined

/** All declarative health layers, tagged and ordered. Never throws. */
export function getHealthConfigLayers(
  options: HealthConfigEnvOptions & {
    runtimeEnv?: Record<string, string | undefined>
  } = {}
): HealthConfigLayers {
  if (!cachedFiles) {
    const directory = getHealthConfigDirectory(options.runtimeEnv)
    cachedFiles = { directory, result: loadHealthConfigFiles(directory) }
  }
  const { directory, result } = cachedFiles
  return {
    layers: [
      { source: 'env', data: loadHealthConfigEnv(options) },
      { source: 'file', directory, data: result.data },
    ],
    skipped: result.skipped,
  }
}

/** Test-only: drop the process-lifetime memo. */
export function _resetHealthConfigCache(): void {
  cachedFiles = undefined
}
