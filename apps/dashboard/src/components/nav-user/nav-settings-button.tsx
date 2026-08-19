import { Settings } from 'lucide-react'

import type { ReactNode } from 'react'

import { IconButton } from '@/components/ui/icon-button'
import { SidebarMenu, SidebarMenuItem } from '@/components/ui/sidebar'
import { WhatsNewButton } from '@/components/whats-new/whats-new-button'

interface NavSettingsButtonProps {
  onClick: () => void
}

/**
 * Sidebar-footer gear that opens the local Settings dialog. Lives beside
 * Sign In / the avatar trigger — not inside SignInButton or DropdownMenu —
 * so it works while signed out.
 */
export function NavSettingsButton({ onClick }: NavSettingsButtonProps) {
  return (
    <IconButton
      tooltip="Settings"
      shortcut="⌘,"
      tooltipSide="right"
      icon={<Settings className="size-4" strokeWidth={1.5} />}
      onClick={onClick}
      aria-label="Open settings"
      data-testid="nav-settings-button"
      className="shrink-0"
    />
  )
}

interface NavUserFooterRowProps {
  canUseSettings: boolean
  onOpenSettings: () => void
  children: ReactNode
}

/** Footer row: `[what's new] [settings gear] [Sign In / avatar]`. */
export function NavUserFooterRow({
  canUseSettings,
  onOpenSettings,
  children,
}: NavUserFooterRowProps) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex items-center gap-1.5">
          <WhatsNewButton />
          {canUseSettings && <NavSettingsButton onClick={onOpenSettings} />}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
