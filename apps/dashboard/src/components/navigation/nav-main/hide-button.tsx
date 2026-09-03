import { EyeOff } from 'lucide-react'

import { useCallback, useRef } from 'react'
import { useOpenSettings } from '@/components/settings/settings-dialog-provider'
import { SidebarMenuAction } from '@/components/ui/sidebar'
import { useUserSettings } from '@/lib/hooks/use-user-settings'
import {
  persistHideMenuHref,
  persistShowMenuHref,
  showHiddenMenuToast,
} from '@/lib/menu/hide-menu-item'
import { cn } from '@/lib/utils'

function useHideMenuItem(): (href: string, title: string) => void {
  const { settings, updateSettings } = useUserSettings()
  const openSettings = useOpenSettings()
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  return useCallback(
    (href: string, title: string) => {
      const hidden = persistHideMenuHref(settingsRef.current, href)
      updateSettings(hidden)
      settingsRef.current = { ...settingsRef.current, ...hidden }

      showHiddenMenuToast({
        title,
        onUndo: () => {
          const shown = persistShowMenuHref(settingsRef.current, href)
          updateSettings(shown)
          settingsRef.current = { ...settingsRef.current, ...shown }
        },
        onOpenNavigation: () => openSettings('navigation'),
      })
    },
    [openSettings, updateSettings]
  )
}

interface HideButtonProps {
  href: string
  title: string
  /**
   * Shift left of the pin, which itself shifts left of the `isNew`/count
   * badge — all three share the same absolute right-hand corner.
   */
  hasBadge?: boolean
}

/**
 * Hover-revealed hide control for a top-level sidebar leaf. Sibling of the
 * link (via `SidebarMenuAction`) so the click never navigates. Same reveal as
 * `PinButton`. Docked rail (`lg`+) only: the overlay sidebar customizes
 * through the group heading dialog, so leaf rows there keep just the pin.
 */
export function HideButton({ href, title, hasBadge }: HideButtonProps) {
  const hideMenuItem = useHideMenuItem()

  if (!href) return null

  return (
    <SidebarMenuAction
      type="button"
      showOnHover
      data-testid="hide-menu-item"
      className={cn(
        'right-7 max-lg:hidden [&>svg]:size-3',
        hasBadge && 'right-12'
      )}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        event.stopPropagation()
        hideMenuItem(href, title)
      }}
      aria-label={`Hide ${title} from menu`}
    >
      <EyeOff />
    </SidebarMenuAction>
  )
}

interface SubHideButtonProps {
  href: string
  title: string
  hasBadge?: boolean
}

/**
 * Hover-revealed hide control for a sidebar sub-item. Matches `SubPinButton`
 * (standalone absolute sibling on `group/menu-sub-item`).
 */
export function SubHideButton({ href, title, hasBadge }: SubHideButtonProps) {
  const hideMenuItem = useHideMenuItem()

  if (!href) return null

  return (
    <button
      type="button"
      data-testid="hide-menu-item"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        hideMenuItem(href, title)
      }}
      aria-label={`Hide ${title} from menu`}
      className={cn(
        'absolute top-1/2 right-7 flex aspect-square size-5 -translate-y-1/2 items-center justify-center rounded-md p-0 text-sidebar-foreground opacity-0 outline-hidden transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:opacity-100 group-data-[collapsible=icon]:hidden max-lg:hidden',
        hasBadge && 'right-12'
      )}
    >
      <EyeOff className="size-3" />
    </button>
  )
}
