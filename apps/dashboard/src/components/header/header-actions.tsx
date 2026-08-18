import { Moon, Sun } from 'lucide-react'
import { useLocation } from '@tanstack/react-router'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { CommandPalette } from '@/components/controls/command-palette'
import { RefreshCountdown } from '@/components/header/refresh-countdown'
import { GlobalTimeRangePicker } from '@/components/header/time-range-picker'
import { InsightsPopover } from '@/components/insights/insights-popover'
import { NotificationsPopover } from '@/components/notifications/notifications-popover'
import { SettingsDialog } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { SETTINGS_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { isFeatureAllowed } from '@/lib/feature-permissions/shared'

interface HeaderActionsProps {
  menuComponent?: React.ReactNode
}

export const HeaderActions = function HeaderActions({
  menuComponent,
}: HeaderActionsProps) {
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { config } = useFeaturePermissions()
  const canUseSettings = isFeatureAllowed(SETTINGS_FEATURE_PERMISSION, config)
  const pathname = useLocation({ select: (l) => l.pathname })
  // The /agents page owns its own surface and has no time-series charts, so the
  // global time-range selector and refresh countdown are noise there.
  const showTimeControls = !pathname?.startsWith('/agents')

  // Handle hydration - set mounted state after client-side render
  useEffect(() => {
    setMounted(true)
  }, [])

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <div className="flex w-max shrink-0 items-center gap-1 sm:ml-auto sm:w-auto sm:gap-3">
      {showTimeControls ? (
        <>
          <GlobalTimeRangePicker />

          <RefreshCountdown />
        </>
      ) : null}

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onOpenSettings={
          canUseSettings ? () => setSettingsOpen(true) : undefined
        }
      />

      {/* Theme toggle - visible on all viewports */}
      {mounted ? (
        <IconButton
          tooltip={
            resolvedTheme === 'light'
              ? 'Switch to dark mode'
              : 'Switch to light mode'
          }
          icon={resolvedTheme === 'light' ? <Moon /> : <Sun />}
          onClick={toggleTheme}
          className="inline-flex min-h-11 min-w-11 lg:min-h-8 lg:min-w-8"
          suppressHydrationWarning
        />
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="inline-flex min-h-11 min-w-11 lg:min-h-8 lg:min-w-8"
          aria-label="Toggle theme"
        >
          <Sun className="size-4" />
        </Button>
      )}

      {/* AI Insights + Notifications - hidden on mobile */}
      <InsightsPopover />
      <NotificationsPopover />
      {menuComponent}

      {canUseSettings && (
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <div />
        </SettingsDialog>
      )}
    </div>
  )
}
