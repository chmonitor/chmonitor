import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { useActiveHostEngine } from '@/lib/hooks/use-active-pg-connection'
import { useUserSettings } from '@/lib/hooks/use-user-settings'
import { revealAlertsWhenActive } from '@/lib/menu/notification-alerts'
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
 * ⌘K catalog: permission / engine / cloud only. Workspace hide does not
 * filter this list — hidden rows stay indexed with a Hidden hint.
 */
export function usePaletteMenuItems() {
  const { config } = useFeaturePermissions()
  const engine = useActiveHostEngine()
  return getAllowedMenuItems(config, engine)
}
