/**
 * Shared, target-agnostic env + binding access for `lib/target` (issue #2187).
 *
 * Both adapters delegate binding access here. This is intentional and is what
 * makes the `getPlatformBindings()` re-implementation a genuine ZERO-BEHAVIOR
 * CHANGE: the current `lib/platform-native.ts` shim already reads bindings from
 * the `cloudflare:workers` `env` and returns the value only when it is an
 * object. That import is build-target-aliased by `vite.config.ts`:
 *   - workerd build → the real Worker `env` (bindings are objects),
 *   - Node build    → `cloudflare-workers-shim.ts` (`env` = `process.env`, so
 *                     bindings are strings/undefined → probe returns `null`),
 *   - bun test      → the same shim, mocked via the test preload.
 * So the probe is already independent of `VITE_DEPLOY_TARGET`; keeping it shared
 * preserves behavior on every runtime (including `vite dev` on workerd, where
 * `VITE_DEPLOY_TARGET` is unset yet a real D1 binding exists).
 */
import { env as workerEnv } from 'cloudflare:workers'

/**
 * Read an env string: Cloudflare Worker binding `env` first (real bindings
 * object on workerd; the `process.env` shim on the Node build), then
 * `process.env`. Empty strings are treated as unset. Never throws.
 *
 * Identical to `lib/feature-permissions/server.ts::readEnv` — the single reader
 * that PR2 will route the ~55 scattered route env reads through.
 */
export function readTargetEnv(key: string): string | undefined {
  try {
    const fromBinding = (workerEnv as Record<string, string | undefined>)?.[key]
    if (fromBinding !== undefined && fromBinding !== '') return fromBinding
  } catch {
    // cloudflare:workers env not available in this context — fall through.
  }
  if (typeof process !== 'undefined' && process.env) {
    const fromProcess = process.env[key]
    if (fromProcess !== undefined && fromProcess !== '') return fromProcess
  }
  return undefined
}

/**
 * Probe a platform binding by name. Returns the binding only when it is a real
 * object (workerd); on the Node build the aliased `env` yields a string/
 * undefined, so this returns `null` and callers degrade to their non-binding
 * path. Matches the exact semantics of the previous `lib/platform-native.ts`.
 */
export function readBinding<T>(bindingName: string): T | null {
  const binding = (workerEnv as Record<string, unknown> | undefined)?.[
    bindingName
  ]
  return binding && typeof binding === 'object' ? (binding as T) : null
}
