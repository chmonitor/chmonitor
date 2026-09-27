import type { MenuItem as MenuItemType } from '@/components/menu/types'
import type {
  UnavailableResolution,
  UnavailableState,
} from '@/lib/menu/unavailable-visibility'

import { useCallback } from 'react'
import {
  tableCheckAvailable,
  useTableAvailability,
} from '@/components/menu/hooks/use-table-availability'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { useUserSettings } from '@/lib/hooks/use-user-settings'
import { metadataDbSatisfied } from '@/lib/menu/metadata-db'
import { resolveUnavailable } from '@/lib/menu/unavailable-visibility'

/**
 * Hook bindings for the one availability policy in
 * `lib/menu/unavailable-visibility.ts`. Every nav render site goes through
 * these hooks, so the expanded rail, the collapsed flyout, and ⌘K cannot
 * disagree about whether a page is available (#3463).
 */

/**
 * The primitive: a resolver for ANY item on this host. The availability read is
 * ONE shared query, so resolving a whole catalog costs the same single request
 * as resolving a single row.
 */
export function useUnavailableResolver(
  hostId: number
): (item: MenuItemType) => UnavailableResolution {
  const { config } = useFeaturePermissions()
  const { settings } = useUserSettings()
  const { available, isLoading } = useTableAvailability(hostId)
  const { dimUnavailablePages } = settings

  return useCallback(
    (item: MenuItemType) => {
      const state: UnavailableState = {
        tableAvailable: tableCheckAvailable(available, item.tableCheck),
        metadataDbSatisfied: metadataDbSatisfied(item, config),
        availabilityLoading: item.tableCheck ? isLoading : false,
        dimUnavailablePages,
      }
      return resolveUnavailable(item, state)
    },
    [available, config, dimUnavailablePages, isLoading]
  )
}

/** Resolve one row. */
export function useUnavailableVisibility(
  item: MenuItemType,
  hostId: number
): UnavailableResolution {
  return useUnavailableResolver(hostId)(item)
}

/**
 * A group's own resolution plus the children that survive it. The caller must
 * return `null` when `visibleChildren` is empty — the guard goes AHEAD of the
 * section element, or the rail renders a heading with a dangling chevron and no
 * body (the rule the `product-design` skill records for data-dependent
 * sections).
 */
export function useGroupVisibility(
  item: MenuItemType,
  hostId: number
): {
  resolution: UnavailableResolution
  visibleChildren: MenuItemType[]
} {
  const resolve = useUnavailableResolver(hostId)

  return {
    resolution: resolve(item),
    visibleChildren: (item.items ?? []).filter(
      (child) => resolve(child).visibility !== 'hidden'
    ),
  }
}
