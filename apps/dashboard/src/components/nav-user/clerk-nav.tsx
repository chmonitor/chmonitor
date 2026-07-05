import {
  Building2,
  ChevronsUpDown,
  CreditCard,
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
import { useState } from 'react'
import { useSettingsShortcut } from '@/components/nav-user/use-settings-shortcut'
import { SettingsDialog } from '@/components/settings'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
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
import { Skeleton } from '@/components/ui/skeleton'
import { useBillingSubscription } from '@/lib/billing/use-billing'
import { isCloudModeClient } from '@/lib/cloud/cloud-mode'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { SETTINGS_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { isFeatureAllowed } from '@/lib/feature-permissions/shared'
import { clearUserConnectionsCache } from '@/lib/hooks/use-user-connections'
import { cn } from '@/lib/utils'

/**
 * Vivid, brand-accented styling for a paid plan badge so it stands out in the
 * muted sidebar footer. Pro = amber→orange (brand), Max = violet→fuchsia, any
 * other paid tier falls back to the solid primary. `free` gets a muted badge
 * (clicking it still opens /billing to upgrade).
 */
const PLAN_BADGE_STYLES: Record<string, string> = {
  free: 'bg-muted text-muted-foreground shadow-none',
  pro: 'bg-gradient-to-r from-amber-400 to-orange-500 text-white dark:from-amber-500 dark:to-orange-600',
  max: 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white dark:from-violet-600 dark:to-fuchsia-600',
}

function planBadgeClassName(plan: string): string {
  return cn(
    'border-transparent font-semibold uppercase tracking-wide shadow-sm',
    PLAN_BADGE_STYLES[plan] ?? 'bg-primary text-primary-foreground'
  )
}

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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { config } = useFeaturePermissions()
  const canUseSettings = isFeatureAllowed(SETTINGS_FEATURE_PERMISSION, config)
  const cloudMode = isCloudModeClient()
  // Billing is cloud-only; gate the query so self-host / OSS never calls it.
  const { data: subscription, isLoading: billingLoading } =
    useBillingSubscription()
  // Null while loading (avoid briefly flashing "free" before the real plan loads)
  // and when not in cloud mode (self-host has no billing).
  const planLabel =
    cloudMode && !billingLoading ? (subscription?.planId ?? 'free') : null
  const openSettings = () => {
    if (canUseSettings) setSettingsOpen(true)
  }
  useSettingsShortcut(openSettings, canUseSettings)

  // Loading state - show skeleton
  if (!isLoaded) {
    return <UserSkeleton />
  }

  return (
    <>
      <SidebarMenu>
        {/* Not signed in - surface plans + a Sign In / Sign Up entry point.
            The plans link sits above the account slot so Sign In stays the
            bottom anchor (matching the signed-in user button position). */}
        {!isSignedIn && (
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              tooltip="View plans"
              data-testid="nav-user-plans"
              render={
                <a href="/billing">
                  <CreditCard />
                  <span>View plans</span>
                </a>
              }
            />
          </SidebarMenuItem>
        )}
        <SidebarMenuItem>
          {/* Not signed in - show Sign In button */}
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

          {/* Signed in - show user menu with avatar */}
          {isSignedIn && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                    data-testid="nav-user-trigger"
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
                    {planLabel && (
                      <Badge
                        className={cn(
                          'h-4 shrink-0 cursor-pointer px-1.5 text-[10px]',
                          planBadgeClassName(planLabel)
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          window.location.href = '/billing'
                        }}
                        data-testid="nav-user-plan-badge"
                      >
                        {planLabel}
                      </Badge>
                    )}
                  </span>
                  <span
                    className="truncate text-xs text-muted-foreground"
                    data-testid="nav-user-email"
                  >
                    {user?.primaryEmailAddress?.emailAddress}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--anchor-width) min-w-56 rounded-lg"
                side={isMobile ? 'bottom' : 'right'}
                align="end"
                sideOffset={4}
              >
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
                        {planLabel && planLabel !== 'free' && (
                          <Badge
                            className={cn(
                              'h-4 px-1.5 text-[10px]',
                              planBadgeClassName(planLabel)
                            )}
                          >
                            {planLabel}
                          </Badge>
                        )}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    className="flex items-center gap-2"
                    onSelect={() => openUserProfile()}
                    data-testid="nav-user-account"
                  >
                    <UserIcon className="size-4" />
                    <span>Account Settings</span>
                  </DropdownMenuItem>
                  {cloudMode && (
                    <>
                      <DropdownMenuItem
                        className="flex items-center gap-2"
                        onClick={() => (window.location.href = '/billing')}
                        data-testid="nav-user-billing"
                      >
                        <CreditCard className="size-4" />
                        <span>Billing & plan</span>
                        {planLabel && planLabel !== 'free' && (
                          <Badge
                            className={cn(
                              'ml-auto h-4 px-1.5 text-[10px]',
                              planBadgeClassName(planLabel)
                            )}
                          >
                            {planLabel}
                          </Badge>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="flex items-center gap-2"
                        onClick={() => (window.location.href = '/organization')}
                        data-testid="nav-user-organization"
                      >
                        <Building2 className="size-4" />
                        <span>
                          {organization ? 'Organization' : 'Create a team'}
                        </span>
                      </DropdownMenuItem>
                    </>
                  )}
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
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="flex items-center gap-2 text-destructive focus:text-destructive"
                  onSelect={async () => {
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

/**
 * Skeleton component shown while Clerk is loading.
 */
function UserSkeleton() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" disabled data-testid="nav-user-trigger">
          <Skeleton className="size-8 rounded-lg" />
          <div className="grid flex-1 gap-1">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
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
