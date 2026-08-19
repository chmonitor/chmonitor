import {
  Building2,
  ChevronsUpDown,
  ExternalLink,
  Info,
  LogOut,
  Settings,
  User as UserIcon,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import {
  SignInButton,
  useClerk,
  useOrganization,
  useUser,
} from '@clerk/tanstack-react-start'
import { NavUserFooterRow } from '@/components/nav-user/nav-settings-button'
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
import { Skeleton } from '@/components/ui/skeleton'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { SETTINGS_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { isFeatureAllowed } from '@/lib/feature-permissions/shared'
import { clearUserConnectionsCache } from '@/lib/hooks/use-user-connections'

/**
 * Clerk-integrated navigation user menu.
 *
 * Displays:
 * - Sign In / Sign Up buttons when not authenticated
 * - User button with avatar and menu when authenticated
 */
export function ClerkNavWrapper() {
  const { user, isLoaded, isSignedIn } = useUser()
  const { openUserProfile, signOut } = useClerk()
  const { organization } = useOrganization()
  const queryClient = useQueryClient()
  const { isMobile } = useSidebar()
  const openSettingsDialog = useOpenSettings()
  const { config } = useFeaturePermissions()
  const canUseSettings = isFeatureAllowed(SETTINGS_FEATURE_PERMISSION, config)
  const openSettings = () => {
    if (canUseSettings) openSettingsDialog()
  }

  // Loading state - show skeleton. Gear stays visible so local settings
  // remain reachable while Clerk loads (no account required).
  if (!isLoaded) {
    return (
      <>
        <NavUserFooterRow
          canUseSettings={canUseSettings}
          onOpenSettings={openSettings}
        >
          <UserSkeletonButton />
        </NavUserFooterRow>
      </>
    )
  }

  return (
    <>
      <NavUserFooterRow
        canUseSettings={canUseSettings}
        onOpenSettings={openSettings}
      >
        {!isSignedIn && (
          <SignInButton mode="modal">
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              data-testid="nav-user-trigger"
            >
              <Avatar className="avatar size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary/10 text-primary">
                  <UserIcon className="size-4" />
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Sign In</span>
                <span className="truncate text-xs text-muted-foreground">
                  or sign up to start
                </span>
              </div>
            </SidebarMenuButton>
          </SignInButton>
        )}

        {isSignedIn && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  data-testid="nav-user-trigger"
                  aria-label="Open user menu"
                />
              }
            >
              <Avatar className="avatar size-8 rounded-lg">
                <AvatarImage
                  src={user?.imageUrl}
                  alt={user?.fullName ?? 'User'}
                />
                <AvatarFallback className="rounded-lg">
                  {getUserInitials(user?.fullName)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="truncate font-medium"
                    data-testid="nav-user-name"
                  >
                    {user?.fullName ?? 'User'}
                  </span>
                </span>
                <span
                  className="truncate text-xs text-muted-foreground"
                  data-testid="nav-user-email"
                >
                  {user?.primaryEmailAddress?.emailAddress}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" aria-hidden="true" />
            </DropdownMenuTrigger>
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
                        src={user?.imageUrl}
                        alt={user?.fullName ?? 'User'}
                      />
                      <AvatarFallback className="rounded-lg">
                        {getUserInitials(user?.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">
                        {user?.fullName ?? 'User'}
                      </span>
                      <span className="truncate text-xs">
                        {user?.primaryEmailAddress?.emailAddress}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5">
                        {organization && (
                          <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-[11px]">
                            <Building2 className="size-3 shrink-0" />
                            <span className="truncate">
                              {organization.name}
                            </span>
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="flex items-center gap-2"
                  onClick={() => openUserProfile()}
                  data-testid="nav-user-account"
                >
                  <UserIcon className="size-4" />
                  <span>Account Settings</span>
                </DropdownMenuItem>
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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="flex items-center gap-2 text-destructive focus:text-destructive"
                onClick={async () => {
                  clearUserConnectionsCache(queryClient)
                  try {
                    await signOut({ redirectUrl: '/' })
                  } catch {
                    // Fallback: force navigation to clear client-side state
                    window.location.href = '/'
                  }
                }}
              >
                <LogOut className="size-4" />
                <span>Sign Out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </NavUserFooterRow>
    </>
  )
}

/**
 * Skeleton button shown while Clerk is loading. Wrapped by NavUserFooterRow
 * so the settings gear does not wait on auth.
 */
function UserSkeletonButton() {
  return (
    <SidebarMenuButton size="lg" disabled data-testid="nav-user-trigger">
      <Skeleton className="size-8 rounded-lg" />
      <div className="grid flex-1 gap-1">
        <Skeleton className="h-4 w-24 rounded" />
        <Skeleton className="h-3 w-16 rounded" />
      </div>
    </SidebarMenuButton>
  )
}

/**
 * Get user initials from full name.
 */
function getUserInitials(fullName: string | undefined | null): string {
  if (!fullName) return 'U'
  const parts = fullName.trim().split(' ')
  if (parts.length === 1) {
    return parts[0]!.charAt(0).toUpperCase()
  }
  return (
    parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)
  ).toUpperCase()
}
