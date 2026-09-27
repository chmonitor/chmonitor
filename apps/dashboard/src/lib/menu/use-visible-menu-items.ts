import { useMemo } from 'react'
import { useUnavailableResolver } from '@/components/menu/hooks/use-unavailable-visibility'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { useActiveHostEngine } from '@/lib/hooks/use-active-pg-connection'
import { useUserSettings } from '@/lib/hooks/use-user-settings'
import { revealAlertsWhenActive } from '@/lib/menu/notification-alerts'
import { filterUnavailableVisibility } from '@/lib/menu/unavailable-visibility'
import {
  getAllowedMenuItems,
  getVisibleMenuItems,
} from '@/lib/menu/visible-items'
import { workspaceFromSettings } from '@/lib/menu/workspace-presets'
import { useHostId } from '@/lib/swr'
import { useNotifications } from '@/lib/swr/use-notifications'

/**
 * Sidebar catalog after permission / engine / workspace gates, with Alerts
 * injected only while the notifications poll reports a count. Groups with
 * one visible child keep their parent (chevron + nested leaf) so hover +
 * can add hidden siblings under that parent.
 */
export function useVisibleMenuItems() {
  const { config } = useFeaturePermissions()
  const engine = useActiveHostEngine()
  const { settings } = useUserSettings()
  const hostId = useHostId()
  const { totalCount, isLoading } = useNotifications(hostId)

  return revealAlertsWhenActive(
    getVisibleMenuItems(config, engine, workspaceFromSettings(settings)),
    !isLoading && totalCount > 0
  )
}

/**
 * ⌘K catalog: permission / engine / cloud only, minus pages that cannot run on
 * this host.
 *
 * Two different hide mechanisms, two different answers (#3463):
 *
 * - **Workspace hide** does NOT filter this list. The user chose it, it is
 *   reversible, and ⌘K plus the *Keep in sidebar* chip is how they get back —
 *   so those rows stay indexed with a Hidden hint.
 * - **Availability hide** DOES filter. Nobody chose it, it is not reversible
 *   from the palette, and landing on the page only produces "System table not
 *   found on this host". Dimmed (config-gated, enableable) pages still stay
 *   indexed: they work once the operator configures the store.
 *
 * Fail-open: while the availability map is in flight every page resolves
 * available, so the palette opens with the full catalog exactly as before.
 */
export function usePaletteMenuItems() {
  const { config } = useFeaturePermissions()
  const engine = useActiveHostEngine()
  const hostId = useHostId()
  const resolve = useUnavailableResolver(hostId)

  return useMemo(() => {
    const allowed = getAllowedMenuItems(config, engine)
    return filterUnavailableVisibility(
      allowed,
      (item) => resolve(item).visibility
    )
  }, [config, engine, resolve])
}
