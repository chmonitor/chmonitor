// Central menu-visibility resolver. A menu item is shown when it passes TWO
// independent gates, applied in one place so every nav surface (sidebar,
// command palette, future ones) stays consistent:
//
//   1. Feature permission  — `filterMenuItemsByPermissions` (auth/deployment)
//   2. Cloud-only          — drop `cloudOnly` items when not in cloud mode
//
// Previously the cloud-only rule lived as inline logic in app-sidebar.tsx and
// clerk-nav.tsx but was missing from the command palette, so ⌘K leaked
// Billing/Organization in self-host / OSS. Encoding the rule as data on the
// item (`cloudOnly: true`) and resolving it here removes that fragility.

import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'
import type { PublicFeaturePermissionConfig } from '@/lib/feature-permissions/types'

import { isCloudModeClient } from '@/lib/cloud/cloud-mode'
import { filterMenuItemsByPermissions } from '@/lib/feature-permissions/menu'

/**
 * Drop `cloudOnly` items (and any parent left empty by their removal) when the
 * deployment is not the cloud product. Recursive so a `cloudOnly` child inside
 * a group is hidden too. Mirrors `filterMenuItemsByPermissions`' empty-parent
 * semantics: a group whose children all vanish is removed rather than rendered
 * childless.
 */
export function filterCloudOnly(
  items: readonly MenuItem[],
  cloudMode: boolean
): MenuItem[] {
  return items.flatMap((item) => {
    if (item.cloudOnly && !cloudMode) return []

    if (!item.items) return [{ ...item }]

    const childItems = filterCloudOnly(item.items, cloudMode)
    if (childItems.length === 0) return []

    return [{ ...item, items: childItems }]
  })
}

/**
 * The single source of truth for what a CLIENT nav surface may render:
 * `menuItemsConfig` with feature-permission and cloud-only gates applied.
 * `isCloudModeClient()` is resolved at build time, so this is cheap and stable
 * across renders.
 */
export function getVisibleMenuItems(
  config: PublicFeaturePermissionConfig
): MenuItem[] {
  const cloudMode = isCloudModeClient()
  const byPermission = filterMenuItemsByPermissions(menuItemsConfig, config)
  return filterCloudOnly(byPermission, cloudMode)
}
