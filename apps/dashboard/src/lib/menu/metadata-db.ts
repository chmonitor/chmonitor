/**
 * Metadata-database gate for menu items (`requiresMetadataDb`).
 *
 * Items whose page persists state in the deployment's metadata database
 * (report subscriptions, shared dashboards, per-user connections) are DIMMED
 * — not hidden — when no state backend is configured: the server derives
 * `metadataDb.available` from `resolveStateBackend()` in
 * `lib/state-backend/config.ts` (D1 binding → `CHM_STATE_CLICKHOUSE_*` →
 * `DATABASE_URL` / `POSTGRES_URL`, #3493). The operator can still turn it on,
 * so hiding the row would delete the discovery path for a feature that ships
 * in the box (#3463).
 *
 * The pure predicate stays the one place the answer is computed; the nav
 * surfaces reach it through `resolveUnavailable` /
 * `useUnavailableResolver`, which own the hide-or-dim verdict.
 */
import type { MenuItem } from '@/components/menu/types'
import type { PublicFeaturePermissionConfig } from '@/lib/feature-permissions/types'

export function metadataDbSatisfied(
  item: Pick<MenuItem, 'requiresMetadataDb'>,
  config: PublicFeaturePermissionConfig
): boolean {
  if (!item.requiresMetadataDb) return true
  return config.metadataDb?.available !== false
}
