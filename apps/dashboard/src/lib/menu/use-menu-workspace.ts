import { menuItemsConfig } from '@/menu'

import { useMemo, useRef } from 'react'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { useActiveHostEngine } from '@/lib/hooks/use-active-pg-connection'
import { useUserSettings } from '@/lib/hooks/use-user-settings'
import {
  persistHideMenuHref,
  persistShowMenuHref,
} from '@/lib/menu/hide-menu-item'
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
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // Every rail row, sub-row, and heading calls this hook; the catalog and
  // hide set only change with permissions, engine, or the workspace settings,
  // not with each route transition that re-renders the rail.
  const catalog = useMemo(
    () => getAllowedMenuItems(config, engine),
    [config, engine]
  )
  const { workspace, hiddenHrefs } = useMemo(() => {
    const next = workspaceFromSettings(settings)
    return {
      workspace: next,
      hiddenHrefs: new Set(effectiveHiddenMenuHrefs(menuItemsConfig, next)),
    }
  }, [settings])

  const showHref = (href: string) => {
    const next = persistShowMenuHref(settingsRef.current, href)
    updateSettings(next)
    settingsRef.current = { ...settingsRef.current, ...next }
  }

  const hideHref = (href: string) => {
    const next = persistHideMenuHref(settingsRef.current, href)
    updateSettings(next)
    settingsRef.current = { ...settingsRef.current, ...next }
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
    hideHref,
    showAll,
  }
}
