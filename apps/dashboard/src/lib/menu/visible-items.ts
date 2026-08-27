// Central menu-visibility resolver. Deployment gates (permission, cloud-only,
// engine) apply to every nav surface. Workspace hide is sidebar / More only —
// the command palette indexes the full allowed catalog so hidden pages stay
// reachable via ⌘K without auto-unhiding.

import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'
import type { PublicFeaturePermissionConfig } from '@/lib/feature-permissions/types'

import { DEFAULT_SOURCE_ENGINE, type SourceEngine } from '@chm/types'
import { isCloudModeClient } from '@/lib/cloud/cloud-mode'
import { filterMenuItemsByPermissions } from '@/lib/feature-permissions/menu'
import {
  applyWorkspaceVisibility,
  type WorkspaceVisibility,
} from '@/lib/menu/workspace-presets'

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
 * Whether a menu item applies to the given source engine (issue #2450).
 *
 * ABSENT `engines` means the ClickHouse family (`clickhouse` +
 * `clickhouse-cloud`), so every existing item shows for ClickHouse hosts and is
 * hidden for Postgres. Postgres-only items (`engines: ['postgres']`) do the
 * reverse. This is the whole zero-diff invariant: for a ClickHouse engine the
 * result is exactly today's menu, and for Postgres only the Postgres items.
 */
function itemMatchesEngine(item: MenuItem, engine: SourceEngine): boolean {
  if (!item.engines || item.engines.length === 0) {
    return engine === 'clickhouse' || engine === 'clickhouse-cloud'
  }
  return item.engines.includes(engine)
}

/**
 * Drop items that don't apply to the active host's engine (and any parent left
 * empty by their removal). Recursive, mirroring {@link filterCloudOnly}.
 */
export function filterMenuItemsByEngine(
  items: readonly MenuItem[],
  engine: SourceEngine
): MenuItem[] {
  return items.flatMap((item) => {
    if (!itemMatchesEngine(item, engine)) return []

    if (!item.items) return [{ ...item }]

    const childItems = filterMenuItemsByEngine(item.items, engine)
    if (childItems.length === 0) return []

    return [{ ...item, items: childItems }]
  })
}

/**
 * Permission / cloud / engine catalog — no workspace hide list. Sidebar
 * applies hide + flatten on top; ⌘K uses this so hidden pages stay indexed.
 */
export function getAllowedMenuItems(
  config: PublicFeaturePermissionConfig,
  engine: SourceEngine = DEFAULT_SOURCE_ENGINE
): MenuItem[] {
  const cloudMode = isCloudModeClient()
  const byPermission = filterMenuItemsByPermissions(menuItemsConfig, config)
  const byCloud = filterCloudOnly(byPermission, cloudMode)
  return filterMenuItemsByEngine(byCloud, engine)
}

/**
 * Sidebar catalog: allowed items plus workspace hide. Flattening of 1-child
 * groups happens in `useVisibleMenuItems` after Alerts injection.
 *
 * Workspace filtering is last and never replaces the deployment gates.
 */
export function getVisibleMenuItems(
  config: PublicFeaturePermissionConfig,
  engine: SourceEngine = DEFAULT_SOURCE_ENGINE,
  workspace?: WorkspaceVisibility
): MenuItem[] {
  const allowed = getAllowedMenuItems(config, engine)
  if (!workspace) return allowed
  return applyWorkspaceVisibility(allowed, workspace)
}

/**
 * Settings > Navigation customize tree: the same engine filter as the real
 * sidebar (`getVisibleMenuItems(..., engine)`), minus footer rows (About lives
 * next to the gear, not in the hide/show list).
 *
 * Defaults to {@link DEFAULT_SOURCE_ENGINE} so unspecified hosts keep today's
 * tree. Pass the ACTIVE host engine (`useActiveHostEngine`) so a Postgres
 * host customizes the Postgres pages, not the Queries/Cluster groups.
 */
export function getSettingsNavMenuItems(
  engine: SourceEngine = DEFAULT_SOURCE_ENGINE
): MenuItem[] {
  return filterMenuItemsByEngine(menuItemsConfig, engine).filter(
    (item) => item.section !== 'footer'
  )
}
