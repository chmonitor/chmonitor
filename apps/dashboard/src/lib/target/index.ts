/**
 * Public entry point for the deploy-target module (issue #2187, PR1).
 *
 * `target()` returns the process-wide adapter, resolved ONCE from
 * `VITE_DEPLOY_TARGET` (fail-closed to `node`) and cached. Server-only — the
 * adapters import `cloudflare:workers`; do not reach this from a client bundle.
 *
 * PR1 scope: only `lib/platform-native.ts` consumes this. Later PRs route the
 * route env reads (PR2) and the version/KV cache (PR3) through it.
 */
import type { TargetAdapter, TargetName } from './types'

import { CloudflareAdapter } from './cloudflare-adapter'
import { NodeAdapter } from './node-adapter'
import { parseTarget } from './resolve'

let _adapter: TargetAdapter | null = null

function createAdapter(name: TargetName): TargetAdapter {
  return name === 'cloudflare' ? new CloudflareAdapter() : new NodeAdapter()
}

/**
 * The resolved deploy-target adapter for this process. Resolved once from
 * `import.meta.env.VITE_DEPLOY_TARGET` and cached for the process lifetime.
 */
export function target(): TargetAdapter {
  if (_adapter) return _adapter
  _adapter = createAdapter(parseTarget(import.meta.env.VITE_DEPLOY_TARGET))
  return _adapter
}

/**
 * Reset the cached adapter — tests only. Lets a test drive `target()` after
 * swapping the adapter that `parseTarget` would pick (via injection helpers).
 */
export function _resetTargetCache(): void {
  _adapter = null
}

export type {
  EnvSource,
  TargetAdapter,
  TargetCapabilities,
  TargetName,
} from './types'

export { CloudflareAdapter } from './cloudflare-adapter'
export { readBinding, readTargetEnv } from './env-access'
export { NodeAdapter } from './node-adapter'
export { parseTarget } from './resolve'
