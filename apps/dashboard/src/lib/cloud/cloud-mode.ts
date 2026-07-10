// Cloud (SaaS) deployment mode. Now derived from the deployment profile
// (lib/config/deployment-mode.ts) when `CHM_CLOUD_MODE` is not set explicitly.
//
// ONE codebase serves two products:
//   - Self-hosted / OSS (Docker, Kubernetes, Cloudflare Workers): the operator's
//     `CLICKHOUSE_HOST` env vars are THEIR real hosts, full access, no sign-in
//     required. This is the default and is never degraded.
//   - Cloud (dash.chmonitor.dev): the env hosts are a PUBLIC, READ-ONLY DEMO
//     (e.g. `duet-ubuntu`) that anonymous visitors can explore. When a visitor
//     signs in they get a clean, empty workspace — the demo is hidden and they
//     connect their own ClickHouse via per-user (D1) connections.
//
// Design invariant (mirrors lib/edition): FAIL-CLOSED to self-hosted. An unset,
// empty, or unrecognised CHM_CLOUD_MODE / VITE_CLOUD_MODE resolves to NOT cloud,
// so the open-source build behaves exactly as before. Cloud behaviour is purely
// additive and only switches on when a deployment explicitly opts in.

import { parseDeploymentMode } from '@/lib/config/deployment-mode'

/**
 * Parse a raw env string into a cloud-mode boolean.
 *
 * Only the exact string `'true'` / `'1'` / `'cloud'` (case-insensitive, trimmed)
 * enables cloud mode. Everything else — undefined, empty, whitespace, junk —
 * resolves to `false`. Never throws.
 */
export function parseCloudMode(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'cloud'
}

/**
 * Client-safe: resolved at build time from `VITE_CLOUD_MODE`
 * (inlined in vite.config.ts CLIENT_ENV). Use in React components / hooks.
 */
export function isCloudModeClient(): boolean {
  return parseCloudMode(import.meta.env.VITE_CLOUD_MODE)
}

/**
 * The cloud-mode value BAKED INTO the client bundle at build time.
 *
 * The browser UI can only ever reflect this value — it never sees runtime env
 * (`CHM_CLOUD_MODE` / `CHM_DEPLOYMENT_MODE`). Enabling cloud mode is therefore a
 * BUILD-TIME contract: it requires a cloud build (VITE_CLOUD_MODE inlined from
 * the canonical `CHM_CLOUD_MODE` in vite.config.ts), not just a runtime flag.
 */
export function clientBuildCloudMode(): boolean {
  return parseCloudMode(import.meta.env.VITE_CLOUD_MODE)
}

export interface CloudModeConsistency {
  /** Cloud mode the SERVER enforces (runtime-aware). */
  server: boolean
  /** Cloud mode baked into the CLIENT bundle at build time. */
  clientBuild: boolean
  /** True when the two disagree — a split-brain deployment. */
  mismatch: boolean
}

/**
 * Detect a split-brain deployment where the server-resolved cloud mode differs
 * from the cloud mode baked into the prebuilt client bundle.
 *
 * This happens when a prebuilt OSS image (client built WITHOUT `VITE_CLOUD_MODE`)
 * is booted with runtime `CHM_DEPLOYMENT_MODE=cloud` / `CHM_CLOUD_MODE=true`:
 * the server then enforces cloud behaviour (demo-host guard, private-host
 * blocking) while the client renders OSS UI (no demo badges, no welcome flow).
 *
 * The reverse (a cloud build with the runtime var unset) is SAFE — fail-closed
 * means both halves degrade to OSS together, so it is not flagged.
 *
 * `clientBuildValue` is injected for testing; production callers use the default
 * (the actual baked-in build constant).
 */
export function detectCloudModeMismatch(
  runtimeEnv?: Record<string, string | undefined>,
  clientBuildValue: boolean = clientBuildCloudMode()
): CloudModeConsistency {
  const server = isCloudModeServer(runtimeEnv)
  return {
    server,
    clientBuild: clientBuildValue,
    mismatch: server !== clientBuildValue,
  }
}

/**
 * Server-side: runtime `CHM_CLOUD_MODE` wins, falling back to the build-time
 * `VITE_CLOUD_MODE`. Pass the Cloudflare `env` binding on the edge; defaults to
 * `process.env` on Node.
 */
export function isCloudModeServer(
  runtimeEnv?: Record<string, string | undefined>
): boolean {
  const source =
    runtimeEnv ?? (typeof process !== 'undefined' ? process.env : {})
  const explicit = source.CHM_CLOUD_MODE ?? import.meta.env.VITE_CLOUD_MODE
  if (explicit !== undefined && explicit !== '') return parseCloudMode(explicit)
  // Derived from the deployment profile: CHM_DEPLOYMENT_MODE=cloud → cloud mode, so the
  // single profile var is enough (no need to also set CHM_CLOUD_MODE).
  return (
    parseDeploymentMode(
      source.CHM_DEPLOYMENT_MODE ?? import.meta.env.VITE_DEPLOYMENT_MODE
    ) === 'cloud'
  )
}
