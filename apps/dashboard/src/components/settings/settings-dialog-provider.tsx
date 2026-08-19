import type { SettingsTab } from '@/lib/settings-tab'

import { SettingsDialog } from './settings-dialog'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { useSettingsShortcut } from '@/components/nav-user/use-settings-shortcut'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { SETTINGS_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { isFeatureAllowed } from '@/lib/feature-permissions/shared'

type OpenSettings = (tab?: SettingsTab) => void

const SettingsDialogContext = createContext<OpenSettings | null>(null)

/**
 * One Settings dialog for the shell (gear, ⌘,, command palette, hide-page
 * toast). Passing a tab opens that pane; omitting it opens General.
 */
export function SettingsDialogProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [initialTab, setInitialTab] = useState<SettingsTab>('general')
  const { config } = useFeaturePermissions()
  const canUseSettings = isFeatureAllowed(SETTINGS_FEATURE_PERMISSION, config)

  const openSettings = useCallback<OpenSettings>(
    (tab = 'general') => {
      if (!canUseSettings) return
      setInitialTab(tab)
      setOpen(true)
    },
    [canUseSettings]
  )

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next) setInitialTab('general')
  }, [])

  useSettingsShortcut(openSettings, canUseSettings)

  const value = useMemo(() => openSettings, [openSettings])

  return (
    <SettingsDialogContext.Provider value={value}>
      {children}
      {canUseSettings ? (
        <SettingsDialog
          open={open}
          onOpenChange={handleOpenChange}
          initialTab={initialTab}
        />
      ) : null}
    </SettingsDialogContext.Provider>
  )
}

/** No-op outside the provider so isolated tests keep working. */
export function useOpenSettings(): OpenSettings {
  return useContext(SettingsDialogContext) ?? (() => {})
}
