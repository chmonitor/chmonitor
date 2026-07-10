/**
 * Pure logic for the "Self-hosted vs ClickHouse Cloud" connection-type
 * selector in {@link ConnectionForm}, extracted so the host-URL normalization
 * can be unit-tested without a React harness (mirrors `first-run-decision.ts`).
 *
 * chmonitor's connection model stores a single `host` URL string (e.g.
 * `https://my.clickhouse.cloud:8443`) — there is no separate `secure`/`port`
 * field (see `BrowserConnection.host`, `validateHostUrl`). So the ClickHouse
 * Cloud preset ("TLS on, port 8443") is realized by normalizing that URL
 * string, not by toggling separate fields.
 */

import type { SourceEngine } from '@chm/types'

/**
 * Connection-type selector value. The two ClickHouse presets differ only in
 * host-URL normalization + hints; `postgres` (phase 2, #2449) selects a
 * DIFFERENT engine and field set (host/port/database/sslmode), gated behind
 * `CHM_FEATURE_POSTGRES_SOURCE`.
 */
export type ConnectionPreset = 'self-hosted' | 'clickhouse-cloud' | 'postgres'

/** Map the connection-type preset to the persisted {@link SourceEngine}. */
export function engineForPreset(preset: ConnectionPreset): SourceEngine {
  switch (preset) {
    case 'clickhouse-cloud':
      return 'clickhouse-cloud'
    case 'postgres':
      return 'postgres'
    default:
      return 'clickhouse'
  }
}

/** Default Postgres TCP port. */
export const POSTGRES_DEFAULT_PORT = 5432

/** Host-field placeholder for the Postgres preset (bare hostname, no scheme). */
export const POSTGRES_HOST_PLACEHOLDER = 'db.example.com'

/** HTTPS interface port ClickHouse Cloud services listen on. */
export const CLOUD_DEFAULT_PORT = 8443

/** Shown as the host-field placeholder when the Cloud preset is active. */
export const CLOUD_HOST_PLACEHOLDER =
  'https://<service-id>.<region>.<cloud>.clickhouse.cloud:8443'

/** Shown as the host-field placeholder for the default self-hosted preset. */
export const SELF_HOSTED_HOST_PLACEHOLDER =
  'https://clickhouse.example.com:8123'

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Normalize a host value entered while the ClickHouse Cloud preset is active
 * so a Cloud service connects on the first try.
 *
 * - Empty input is returned as-is (never fabricate a host).
 * - A bare hostname (no scheme — e.g. pasted straight from the ClickHouse
 *   Cloud console) is wrapped into a full HTTPS URL on the Cloud port, since
 *   no protocol was ever explicitly chosen.
 * - A full URL only gets a missing HTTPS port filled in (8443). An explicit
 *   protocol choice (e.g. a deliberate `http://`) is never silently
 *   overridden — Cloud requires TLS, but that's surfaced via the
 *   Cloud-specific connection-error hint instead of a magic rewrite.
 */
export function applyCloudHostDefaults(host: string): string {
  const trimmed = host.trim()
  if (!trimmed) return trimmed

  if (!SCHEME_RE.test(trimmed)) {
    const [hostname, port] = trimmed.split(':')
    return `https://${hostname}:${port ?? CLOUD_DEFAULT_PORT}`
  }

  try {
    const url = new URL(trimmed)
    if (!url.port && url.protocol === 'https:') {
      url.port = String(CLOUD_DEFAULT_PORT)
      return url.origin
    }
    return trimmed
  } catch {
    return trimmed
  }
}
