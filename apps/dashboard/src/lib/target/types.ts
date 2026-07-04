/**
 * Deploy-target adapter contract (issue #2187, PR1).
 *
 * ONE seam for "where is this code running and what platform primitives can it
 * reach". Consolidates the three previously-disconnected platform seams:
 *   - `@chm/platform` (D1/DO bindings — aliased to `lib/platform-native.ts`),
 *   - `lib/feature-permissions/server.ts::readEnv()` (env-string reads), and
 *   - `lib/version-cache.ts` (the globalThis KV probe).
 *
 * The adapter is resolved ONCE at startup from `VITE_DEPLOY_TARGET`
 * (`lib/target/resolve.ts`), fail-closed to `node` — an unset/junk value NEVER
 * silently assumes Cloudflare. Mirrors the fail-closed philosophy of
 * `lib/cloud/cloud-mode.ts` and `lib/config/deployment-mode.ts`.
 *
 * DESIGN INVARIANT: this module is orthogonal to deployment-mode (oss|cloud) and
 * edition. It must not import from `lib/cloud`, `lib/config/deployment-mode`,
 * `lib/edition`, or any store (enforced by a depcruise leaf rule).
 *
 * Cloudflare primitive types (`D1Database`, `KVNamespace`,
 * `DurableObjectNamespace`) are provided globally by `@cloudflare/workers-types`.
 */

/** Resolved target platform. */
export type TargetName = 'cloudflare' | 'node'

/** Where the adapter reads env strings from (advisory metadata). */
export type EnvSource = 'cloudflare' | 'process'

/**
 * Static capability flags for the resolved target. Advisory: consumed by later
 * PRs (e.g. PR4 `selfScheduling`); not wired into binding access, which always
 * probes safely regardless of these flags.
 */
export interface TargetCapabilities {
  readonly d1: boolean
  readonly kv: boolean
  readonly durableObject: boolean
  readonly queue: boolean
}

/**
 * A resolved deploy-target adapter. Binding accessors return `null` when the
 * binding is absent (self-host / Node / local dev without the binding) — callers
 * MUST treat `null` as "not configured" and degrade to their non-binding path.
 */
export interface TargetAdapter {
  /** Resolved target name. */
  readonly name: TargetName
  /** Read an env string (Worker binding env first, then `process.env`). */
  env(key: string): string | undefined
  /** Which env source this adapter prefers. */
  envSource(): EnvSource
  /** Get a D1 database binding by name, or `null` when unbound. */
  d1(bindingName: string): D1Database | null
  /** Get a KV namespace binding by name, or `null` when unbound. */
  kv(bindingName: string): KVNamespace | null
  /** Get a Durable Object namespace binding by name, or `null` when unbound. */
  durableObject(bindingName: string): DurableObjectNamespace | null
  /** Static capability flags for this target. */
  readonly capabilities: TargetCapabilities
}
