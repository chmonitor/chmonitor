/**
 * Adapter resolution from `VITE_DEPLOY_TARGET` (issue #2187, PR1).
 *
 * Fail-closed to `node`: only the exact string `cf` selects Cloudflare;
 * everything else — `docker`, `helm`, `dev`, `unknown`, empty, whitespace, junk,
 * `undefined` — resolves to `node`. This NEVER silently assumes Cloudflare from
 * an unset/garbage value, mirroring `parseCloudMode` / `parseDeploymentMode`.
 */
import type { TargetName } from './types'

/**
 * Pure parse of a raw `VITE_DEPLOY_TARGET` value into a target name. Never
 * throws. Kept pure (no `import.meta.env` access) so it is directly unit-testable
 * — `VITE_DEPLOY_TARGET` is build-inlined and cannot be mutated at test runtime.
 */
export function parseTarget(value: string | null | undefined): TargetName {
  return value?.trim().toLowerCase() === 'cf' ? 'cloudflare' : 'node'
}
