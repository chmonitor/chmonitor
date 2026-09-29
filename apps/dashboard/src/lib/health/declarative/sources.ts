/**
 * Shared plumbing for the seven stores' declarative readers (#3497).
 *
 * Each store owns a small reader beside its DB reader that maps these layers
 * into its row shape and merges both through the one `mergeSources` helper.
 * This module provides what every reader shares: the layers themselves
 * (#3496), `*Env` secret resolution at read time, and the SSRF guard for
 * declared outbound URLs. Declarative entries apply to every owner
 * (deployment-wide, like the existing env fallbacks). It imports no store, so
 * the stores can import it without a cycle.
 *
 * The one gate: the file layer is read only when the build-time
 * `import.meta.env.SSR` constant is true, and the loader (node:fs + yaml) is
 * imported dynamically inside that branch — so the client bundle never
 * contains it, and a store module that the UI imports for a constant does not
 * form an evaluation-order cycle with the loader (`schema.ts` imports a
 * store). The env layer (`env-layer.ts`) has no filesystem dependency and is
 * read on every runtime, as the env fallbacks always were.
 *
 * Logs name the entry id and env var NAME only — never a secret or URL — and
 * each distinct message is logged once per process, not on every sweep tick.
 */

import type { HealthConfigLayer } from './schema'

import { loadHealthConfigEnv } from './env-layer'
import { warn } from '@chm/logger'

/**
 * Both declarative layers, lowest precedence first. The env layer is built on
 * every runtime; the file layer only where the build-time SSR constant holds
 * (the loader is imported inside that branch). Never throws.
 */
export async function readHealthConfigLayers(): Promise<HealthConfigLayer[]> {
  const layers: HealthConfigLayer[] = [
    { source: 'env', data: loadHealthConfigEnv() },
  ]
  if (import.meta.env.SSR) {
    try {
      const { getHealthConfigLayers } = await import('./loader')
      for (const layer of getHealthConfigLayers().layers) {
        if (layer.source === 'file') layers.push(layer)
      }
    } catch (err) {
      // The loader never throws by contract; this only guards a broken import.
      warn(
        `[health-config] file layer unavailable: ${err instanceof Error ? err.name : 'Error'}`
      )
    }
  }
  return layers
}

const warned = new Set<string>()

/** Warn once per process per message: stores re-read on every sweep tick. */
export function warnOnce(message: string): void {
  if (warned.has(message)) return
  warned.add(message)
  warn(message)
}

function envValue(name: string): string {
  const env = typeof process !== 'undefined' ? process.env : {}
  return env[name]?.trim() ?? ''
}

/** Resolve a `*Env` reference, or warn (id + var name only) and return ''. */
export function resolveSecretEnv(
  kind: string,
  id: string,
  name: string
): string {
  const value = envValue(name)
  if (!value) {
    warnOnce(
      `[health-config] Skipping ${kind} "${id}": env var ${name} is not set`
    )
  }
  return value
}

// Per-process memo of the SSRF verdict per URL, so the sweep does not resolve
// a declared host on every tick. An allowed URL is kept for the process; a
// rejection expires after REJECTION_TTL_MS, so one transient DNS failure does
// not drop a declared route for the life of the pod.
const REJECTION_TTL_MS = 5 * 60_000
const urlVerdicts = new Map<
  string,
  { verdict: Promise<boolean>; expiresAt: number }
>()

/**
 * HTTPS-only plus the shared `validateHostUrl` guard — the same checks the
 * API write paths run (`routes.ts`, `alert-config.ts`). A declared URL that
 * fails is dropped with a warn naming the entry, never the URL.
 */
export async function isAllowedDeclaredUrl(
  kind: string,
  id: string,
  url: string
): Promise<boolean> {
  let entry = urlVerdicts.get(url)
  if (!entry || entry.expiresAt <= Date.now()) {
    const pending: { verdict: Promise<boolean>; expiresAt: number } = {
      verdict: Promise.resolve(false),
      expiresAt: Number.POSITIVE_INFINITY,
    }
    pending.verdict = (async () => {
      if (!url.startsWith('https://')) return false
      const { validateHostUrl } = await import(
        '@/lib/browser-connections/host-url'
      )
      return (await validateHostUrl(url)) === null
    })()
      .catch(() => false)
      .then((ok) => {
        if (!ok) pending.expiresAt = Date.now() + REJECTION_TTL_MS
        return ok
      })
    entry = pending
    urlVerdicts.set(url, entry)
  }
  const ok = await entry.verdict
  if (!ok) {
    warnOnce(
      `[health-config] Skipping ${kind} "${id}": URL is not an allowed HTTPS endpoint`
    )
  }
  return ok
}

/** Test-only: drop the per-process URL verdict and warn-once memos. */
export function _resetDeclarativeUrlVerdicts(): void {
  urlVerdicts.clear()
  warned.clear()
}
