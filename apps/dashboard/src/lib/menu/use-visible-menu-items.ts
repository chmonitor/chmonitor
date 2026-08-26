import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { useActiveHostEngine } from '@/lib/hooks/use-active-pg-connection'
import { useUserSettings } from '@/lib/hooks/use-user-settings'
import { revealAlertsWhenActive } from '@/lib/menu/notification-alerts'
import { getVisibleMenuItems } from '@/lib/menu/visible-items'
import { workspaceFromSettings } from '@/lib/menu/workspace-presets'
import { useHostId } from '@/lib/swr'
import { useNotifications } from '@/lib/swr/use-notifications'

/**
 * Sidebar + ⌘K catalog after permission / engine / workspace gates, with
 * Alerts injected only while the notifications poll reports a count.
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
