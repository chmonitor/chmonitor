import type { BrowserConnection } from '@/lib/types/browser-connection'

// Structurally identical to `ConnectionFormData` (connection-form.tsx), but
// sourced from the shared type module instead — importing from
// connection-form.tsx directly would create a circular import, since it in
// turn imports SAMPLE_CLUSTER_PRESET from this file.
type SampleClusterPreset = Pick<
  BrowserConnection,
  'name' | 'host' | 'user' | 'password'
>

/**
 * "Try with sample ClickHouse" onboarding preset — the public ClickHouse
 * Playground (https://clickhouse.com/docs/getting-started/playground),
 * operated by ClickHouse, Inc. `explorer` is a genuinely public, non-secret,
 * read-only account documented in ClickHouse's own docs — safe to embed in
 * client code (there is no separate secret to leak).
 *
 * Read-only is enforced server-side by ClickHouse's own grants (DDL/INSERT are
 * rejected for `explorer`), not by anything in this app. IMPORTANT: this
 * shared public demo also restricts SELECT on several `system.*` tables
 * chmonitor relies on (query_log, parts, merges, processes, replicas,
 * mutations, disks, errors) — verified via direct query, ACCESS_DENIED on all
 * of those. Schema browsing (`system.tables`/`databases`), `system.metrics`,
 * `system.settings`/`functions`, and the SQL explorer/AI chat work fine; the
 * operational monitoring pages (queries, merges, replication, disk, errors)
 * will show their normal empty/error states against this endpoint. Copy
 * referencing this preset should not overpromise a full monitoring demo.
 *
 * A single named constant so the endpoint can be swapped in one place (e.g.
 * for a differently-provisioned public demo with broader `system.*` access)
 * without touching call sites.
 */
export const SAMPLE_CLUSTER_PRESET: SampleClusterPreset = {
  name: 'Sample ClickHouse (read-only)',
  host: 'https://play.clickhouse.com',
  user: 'explorer',
  password: '',
}

/** True when `host` (as saved/entered) matches the sample preset's endpoint. */
export function isSampleClusterHost(host: string): boolean {
  return host.trim() === SAMPLE_CLUSTER_PRESET.host
}
