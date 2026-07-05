import {
  ChevronsUpDown,
  ExternalLink,
  Info,
  Settings,
  ShieldCheck,
} from 'lucide-react'

import { ClerkNavWrapper as ClerkNavWrapperImpl } from './nav-user/clerk-nav'
import { useState } from 'react'
import { ClientOnly } from '@/components/client-only'
import { useAuthIdentity } from '@/components/nav-user/use-auth-identity'
import { useSettingsShortcut } from '@/components/nav-user/use-settings-shortcut'
import { SettingsDialog } from '@/components/settings'
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
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { SETTINGS_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { isFeatureAllowed } from '@/lib/feature-permissions/shared'

// Gate the Clerk navigation behind the build-time `isClerkEnabled()` constant.
// Importing the module is inert (Clerk hooks only run when the component is
// rendered, which stays gated below); using a static ESM import instead of
// `require()` keeps this valid in the Vite/TanStack Start (ESM) runtime, where
// `require` is undefined and previously crashed every page that mounts the shell.
const ClerkNavWrapper = isClerkEnabled() ? ClerkNavWrapperImpl : null

// Human-readable provenance for a reverse-proxy-forwarded identity, keyed by the
// runtime auth provider. Only `trusted`/`proxy` forward a profile; `none`/`clerk`
// have no entry (no badge is shown for them).
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Under reverse-proxy auth (`trusted`/`proxy`), show the forwarded identity
  // instead of the static guest user. No-op for other providers.
  const proxyIdentity = useAuthIdentity()
  const displayUser = proxyIdentity ?? user
  const { config } = useFeaturePermissions()
  // Surface WHERE this identity came from: under reverse-proxy auth the profile
  // is forwarded by the proxy (oauth2-proxy / Traefik forward-auth), not a
  // first-party login. Only shown when a forwarded identity is actually present.
  const authSourceLabel = proxyIdentity
    ? AUTH_SOURCE_LABELS[config.authProvider]
    : undefined
  const canUseSettings = isFeatureAllowed(SETTINGS_FEATURE_PERMISSION, config)
  const openSettings = () => {
    if (canUseSettings) setSettingsOpen(true)
  }
  useSettingsShortcut(openSettings, canUseSettings)

  // If Clerk is enabled, use Clerk navigation
  if (isClerkEnabled() && ClerkNavWrapper) {
    return <ClerkNavWrapper />
  }

  // Otherwise, show guest user dropdown (original behavior)
  // Static fallback button shown during SSR (no dropdown interaction)
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
      <SidebarMenu>
        <SidebarMenuItem>
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
                        <AvatarFallback className="rounded-lg">
                          G
                        </AvatarFallback>
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
                      onSelect={() => {
                        setSettingsOpen(true)
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
        </SidebarMenuItem>
      </SidebarMenu>
      {canUseSettings && (
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <div />
        </SettingsDialog>
      )}
    </>
  )
}
