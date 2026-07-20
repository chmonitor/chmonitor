/**
 * Metadata-database gate for menu items (`requiresMetadataDb`).
 *
 * Items whose page persists state in the deployment's metadata database
 * (report subscriptions, shared dashboards, per-user connections) are DIMMED —
 * not hidden — when no metadata DB (D1 binding or Postgres URL) is configured,
 * mirroring the `tableCheck` muting treatment so OSS keeps its UX surface.
 */
import type { MenuItem } from '@/components/menu/types'
import type { PublicFeaturePermissionConfig } from '@/lib/feature-permissions/types'

import { useFeaturePermissions } from '@/lib/feature-permissions/context'

/**
 * Whether the item's metadata-DB requirement is satisfied. Items without the
 * flag always pass. An ABSENT `metadataDb` block in the config (older server,
 * config fetch failed) also passes — fail-open so the menu never dims on a
 * transient config error.
 */
export function metadataDbSatisfied(
  item: Pick<MenuItem, 'requiresMetadataDb'>,
  config: PublicFeaturePermissionConfig
): boolean {
  if (!item.requiresMetadataDb) return true
  return config.metadataDb?.available !== false
}

/** Hook form of {@link metadataDbSatisfied} for nav renderers. */
export function useMetadataDbSatisfied(
  item: Pick<MenuItem, 'requiresMetadataDb'>
): boolean {
  const { config } = useFeaturePermissions()
  return metadataDbSatisfied(item, config)
}
