import {
  ChevronsUpDown,
  ExternalLink,
  Info,
  Settings,
  ShieldCheck,
} from 'lucide-react'

import { ClerkNavWrapper as ClerkNavWrapperImpl } from './clerk-nav'
import { NavUserFooterRow } from './nav-settings-button'
import { useAuthIdentity } from './use-auth-identity'
import { ClientOnly } from '@/components/layout/client-only'
import { useOpenSettings } from '@/components/settings/settings-dialog-provider'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenuButton, useSidebar } from '@/components/ui/sidebar'
import { WhatsNewMenuItem } from '@/components/whats-new/whats-new-menu-item'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { SETTINGS_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { isFeatureAllowed } from '@/lib/feature-permissions/shared'

// Static ESM import, not `require()`: `require` is undefined in the Vite/TanStack
// Start runtime. Importing is inert; Clerk hooks only run when rendered.
const ClerkNavWrapper = isClerkEnabled() ? ClerkNavWrapperImpl : null

const AUTH_SOURCE_LABELS: Record<string, string | undefined> = {
  trusted: 'via trusted proxy',
  proxy: 'via auth proxy',
}

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    avatar: string
  }
}) {
  const { isMobile } = useSidebar()
  const openSettingsDialog = useOpenSettings()
  const proxyIdentity = useAuthIdentity()
  const displayUser = proxyIdentity ?? user
  const { config } = useFeaturePermissions()
  const authSourceLabel = proxyIdentity
    ? AUTH_SOURCE_LABELS[config.authProvider]
    : undefined
  const canUseSettings = isFeatureAllowed(SETTINGS_FEATURE_PERMISSION, config)
  const openSettings = () => {
    if (canUseSettings) openSettingsDialog()
  }

  if (isClerkEnabled() && ClerkNavWrapper) {
    return <ClerkNavWrapper />
  }

  const userButton = (
    <SidebarMenuButton
      size="lg"
      className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
      data-testid="nav-user-trigger"
    >
      <Avatar className="avatar size-8 rounded-lg">
        <AvatarImage src={displayUser.avatar} alt={displayUser.name} />
        <AvatarFallback className="rounded-lg">G</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium" data-testid="nav-user-name">
          {displayUser.name}
        </span>
        <span className="truncate text-xs" data-testid="nav-user-email">
          {displayUser.email}
        </span>
      </div>
      <ChevronsUpDown className="ml-auto size-4" />
    </SidebarMenuButton>
  )

  return (
    <>
      <NavUserFooterRow
        canUseSettings={canUseSettings}
        onOpenSettings={openSettings}
      >
        <ClientOnly fallback={userButton}>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger render={userButton} />
            <DropdownMenuContent
              className="w-(--anchor-width) min-w-56 rounded-lg"
              side={isMobile ? 'bottom' : 'right'}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <Avatar className="avatar size-8 rounded-lg">
                      <AvatarImage
                        src={displayUser.avatar}
                        alt={displayUser.name}
                      />
                      <AvatarFallback className="rounded-lg">G</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">
                        {displayUser.name}
                      </span>
                      <span className="truncate text-xs">
                        {displayUser.email}
                      </span>
                      {authSourceLabel && (
                        <span
                          className="mt-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"
                          data-testid="nav-user-auth-source"
                        >
                          <ShieldCheck className="size-3 shrink-0" />
                          <span className="truncate">{authSourceLabel}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <WhatsNewMenuItem />
                <DropdownMenuItem
                  className="flex items-center gap-2"
                  onClick={() => (window.location.href = '/about')}
                  data-testid="nav-user-about"
                >
                  <Info className="size-4" />
                  <span>About</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  render={
                    <a
                      href="https://github.com/chmonitor/chmonitor"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2"
                      data-testid="nav-user-github"
                    >
                      <ExternalLink className="size-4" />
                      <span>GitHub Repo</span>
                    </a>
                  }
                />
                {canUseSettings && (
                  <DropdownMenuItem
                    className="flex items-center gap-2"
                    onClick={() => {
                      openSettings()
                    }}
                    data-testid="nav-user-settings"
                  >
                    <Settings className="size-4" />
                    <span>Settings</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      ⌘,
                    </span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </ClientOnly>
      </NavUserFooterRow>
    </>
  )
}
