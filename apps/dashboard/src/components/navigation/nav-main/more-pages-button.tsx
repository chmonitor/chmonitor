import { Ellipsis } from 'lucide-react'
import { menuItemsConfig } from '@/menu'

import { useOpenSettings } from '@/components/settings/settings-dialog-provider'
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { SETTINGS_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { isFeatureAllowed } from '@/lib/feature-permissions/shared'
import { useUserSettings } from '@/lib/hooks/use-user-settings'
import {
  effectiveHiddenMenuHrefs,
  workspaceFromSettings,
} from '@/lib/menu/workspace-presets'

/**
 * Opens Settings → Navigation when the workspace hide list is non-empty
 * (#3292). Restore is already in that tree (Show / Full); this is the
 * sidebar entry so users do not have to remember the gear.
 */
export function MorePagesButton() {
  const { settings } = useUserSettings()
  const { isMobile, setOpenMobile } = useSidebar()
  const openSettings = useOpenSettings()
  const { config } = useFeaturePermissions()
  const canUseSettings = isFeatureAllowed(SETTINGS_FEATURE_PERMISSION, config)
  const hiddenCount = effectiveHiddenMenuHrefs(
    menuItemsConfig,
    workspaceFromSettings(settings)
  ).length

  if (!canUseSettings || hiddenCount === 0) return null

  return (
    <SidebarGroup className="p-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Show hidden pages in Settings → Navigation"
            className="h-11 min-h-11 lg:h-8 lg:min-h-8 text-muted-foreground"
            data-testid="more-pages-button"
            onClick={() => {
              if (isMobile) setOpenMobile(false)
              openSettings('navigation')
            }}
          >
            <Ellipsis className="size-4 shrink-0" strokeWidth={1.5} />
            <span>More pages</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
