import { menuItemsConfig } from '@/menu'

import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { useActiveHostEngine } from '@/lib/hooks/use-active-pg-connection'
import { useUserSettings } from '@/lib/hooks/use-user-settings'
import { persistShowMenuHref } from '@/lib/menu/hide-menu-item'
import { getAllowedMenuItems } from '@/lib/menu/visible-items'
import {
  applyWorkspacePreset,
  effectiveHiddenMenuHrefs,
  workspaceFromSettings,
} from '@/lib/menu/workspace-presets'

/** Allowed catalog + workspace hide set for hover-Add, More, and in-page links. */
export function useMenuWorkspaceCatalog() {
  const { config } = useFeaturePermissions()
  const engine = useActiveHostEngine()
  const { settings, updateSettings } = useUserSettings()
  const catalog = getAllowedMenuItems(config, engine)
  const workspace = workspaceFromSettings(settings)
  const hiddenHrefs = new Set(
    effectiveHiddenMenuHrefs(menuItemsConfig, workspace)
  )

  const showHref = (href: string) => {
    updateSettings(persistShowMenuHref(settings, href))
  }

  const showAll = () => {
    const next = applyWorkspacePreset(menuItemsConfig, workspace, 'full')
    updateSettings({
      workspacePreset: next.workspacePreset,
      hiddenMenuHrefs: [...next.hiddenMenuHrefs],
    })
  }

  return {
    catalog,
    workspace,
    hiddenHrefs,
    settings,
    updateSettings,
    showHref,
    showAll,
  }
}
