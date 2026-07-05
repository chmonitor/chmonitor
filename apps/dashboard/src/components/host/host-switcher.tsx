import { ChevronsUpDown, GlobeIcon, Info, Pencil, PlusIcon } from 'lucide-react'

import { HostDetailsDialog } from './host-details-dialog'
import { HostMenuRow } from './host-menu-row'
import { HostVersionWithStatus } from './host-version-status'
import {
  LogoStatusIndicator,
  LogoStatusIndicatorSkeleton,
} from './logo-status-indicator'
import { useEffect, useState } from 'react'
import { AddHostDialog } from '@/components/connections'
import { ChmonitorLogo } from '@/components/icons/chmonitor-logo'
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
import { canEditHost } from '@/lib/host-permissions'
import { usePathname, useRouter, useSearchParams } from '@/lib/next-compat'
import { useHostId } from '@/lib/swr'
import {
  isServerHost,
  type MergedHostInfo,
  useMergedHosts,
} from '@/lib/swr/use-merged-hosts'
import { buildUrl } from '@/lib/url/url-builder'
import { cn, getHost } from '@/lib/utils'

/**
 * Host switcher component for sidebar header.
 *
 * Provides dropdown menu for switching between ClickHouse hosts.
 * Shows host icon, name, and status in collapsed/expanded states.
 */
export function HostSwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isMobile, state } = useSidebar()
  const { hosts, isLoading, error, isUnauthorized } = useMergedHosts()
  const currentHostId = useHostId()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  // Controlled so a per-row "details/edit" click can close the menu before the
  // dialog opens — otherwise the dropdown's focus trap fights the dialog's.
  const [menuOpen, setMenuOpen] = useState(false)
  const [detailsHost, setDetailsHost] = useState<MergedHostInfo | null>(null)

  const activeHost =
    hosts.find((h) => h.id === currentHostId) ?? hosts[0] ?? null
  const showExpanded = isMobile || state === 'expanded'

  // Guard against a hung load (e.g. a signed-in user whose server-stored
  // connections request never resolves) trapping the switcher on the skeleton
  // forever. After a short grace period we fall through to the resolved state —
  // which, for a user with no host yet, is the "Add Host" CTA below.
  const [loadTimedOut, setLoadTimedOut] = useState(false)
  useEffect(() => {
    if (!isLoading) {
      setLoadTimedOut(false)
      return
    }
    const timer = setTimeout(() => setLoadTimedOut(true), 6000)
    return () => clearTimeout(timer)
  }, [isLoading])

  const handleHostChange = (hostId: number) => {
    const url = buildUrl(pathname, { host: hostId }, searchParams)
    router.push(url)
  }

  // Show the skeleton only while we still have nothing to render and the load
  // hasn't timed out. If hosts already resolved from a faster source, render
  // them instead of flashing a skeleton over a slow secondary fetch.
  if (isLoading && hosts.length === 0 && !loadTimedOut) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            render={
              <div
                className={cn(
                  'flex gap-2',
                  showExpanded ? 'items-center' : 'items-center justify-center'
                )}
              />
            }
          >
            <div className="relative">
              <ChmonitorLogo width={20} height={20} className="size-5" />
              {!showExpanded && <LogoStatusIndicatorSkeleton />}
            </div>
            {showExpanded && (
              <div className="grid flex-1 gap-1.5 text-left text-sm leading-tight">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  // No active host: keep switcher shape and surface why
  if (!activeHost) {
    // Genuine empty state — signed in, no host configured yet, and neither an
    // auth nor a fetch error. Show a one-click "Add Host" CTA (opens the dialog
    // directly) rather than a subtle dropdown, so getting started is obvious.
    if (!isUnauthorized && !error) {
      return (
        <>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                onClick={() => setAddDialogOpen(true)}
                className={cn(!showExpanded && 'justify-center')}
                data-testid="host-switcher-empty"
                aria-label={showExpanded ? undefined : 'Add host'}
              >
                <PlusIcon className="size-5" />
                {showExpanded && (
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Add Host</span>
                    <span className="truncate text-xs text-muted-foreground">
                      Connect a ClickHouse host
                    </span>
                  </div>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <AddHostDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
        </>
      )
    }

    // Auth or fetch error: keep the informative dropdown shape.
    const { label, hint } = isUnauthorized
      ? { label: 'Sign in to load hosts', hint: 'Authentication required' }
      : { label: "Couldn't load hosts", hint: 'Tap to retry from a page' }

    return (
      <>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className={cn(
                      'data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground',
                      !showExpanded && 'justify-center'
                    )}
                    data-testid="host-switcher-empty"
                    aria-label={showExpanded ? undefined : label}
                  />
                }
              >
                <div className="relative">
                  <ChmonitorLogo
                    width={20}
                    height={20}
                    className="size-5 opacity-50"
                  />
                </div>
                {showExpanded && (
                  <>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium text-muted-foreground">
                        {label}
                      </span>
                      <span className="truncate text-xs text-muted-foreground/70">
                        {hint}
                      </span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={4}>
                <DropdownMenuItem
                  onClick={() => setAddDialogOpen(true)}
                  data-testid="add-host"
                >
                  <PlusIcon className="size-4" />
                  Add host…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
        <AddHostDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
      </>
    )
  }

  const showDropdown = true

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          {showDropdown ? (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className={cn(
                      'data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground',
                      !showExpanded && 'justify-center'
                    )}
                    data-testid="host-switcher"
                    aria-label={
                      showExpanded
                        ? undefined
                        : `Select ClickHouse host. Current: ${activeHost.name || getHost(activeHost.host)}`
                    }
                  />
                }
              >
                <div className="relative">
                  <ChmonitorLogo width={20} height={20} className="size-5" />
                  {!showExpanded && isServerHost(activeHost.source) && (
                    <LogoStatusIndicator hostId={activeHost.id} />
                  )}
                </div>
                {showExpanded && (
                  <>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="flex items-center gap-1.5 truncate font-semibold">
                        <span className="truncate">
                          {activeHost.name || getHost(activeHost.host)}
                        </span>
                      </span>
                      {isServerHost(activeHost.source) ? (
                        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <HostVersionWithStatus hostId={activeHost.id} />
                        </span>
                      ) : (
                        <span className="truncate text-xs text-muted-foreground">
                          {activeHost.source === 'database'
                            ? 'Saved to server'
                            : 'Saved in browser'}
                        </span>
                      )}
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--anchor-width) min-w-56 rounded-lg"
                align="start"
                side={isMobile ? 'bottom' : 'right'}
                sideOffset={4}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    ClickHouse Hosts
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {hosts.map((host) => {
                  const hostLabel = host.name || getHost(host.host)
                  const editable = canEditHost(host.source)
                  return (
                    <DropdownMenuItem
                      key={`${host.source}-${host.id}`}
                      onClick={() => handleHostChange(host.id)}
                      className="gap-2 p-2"
                      data-testid={`host-option-${host.id}`}
                    >
                      {!isServerHost(host.source) && (
                        <GlobeIcon className="size-3 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <HostMenuRow
                          hostId={isServerHost(host.source) ? host.id : null}
                          hostName={hostLabel}
                          isActive={host.id === currentHostId}
                          skipStatus={!isServerHost(host.source)}
                        />
                      </div>
                      {/* stopPropagation keeps the click from also switching the
                          active host; closing the menu first avoids a focus-trap
                          clash with the dialog that opens next. */}
                      <button
                        type="button"
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 transition-opacity hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        aria-label={
                          editable
                            ? `Edit ${hostLabel}`
                            : `View ${hostLabel} details`
                        }
                        data-testid={`host-option-${host.id}-details`}
                        onClick={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          setDetailsHost(host)
                          setMenuOpen(false)
                        }}
                      >
                        {editable ? (
                          <Pencil className="size-3.5" />
                        ) : (
                          <Info className="size-3.5" />
                        )}
                      </button>
                    </DropdownMenuItem>
                  )
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setAddDialogOpen(true)}
                  data-testid="add-host"
                  className="gap-2 text-muted-foreground"
                >
                  <PlusIcon className="size-4" />
                  Add host…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <SidebarMenuButton
              size="lg"
              render={
                <div
                  className={cn(
                    'flex gap-2',
                    showExpanded
                      ? 'items-center'
                      : 'items-center justify-center'
                  )}
                />
              }
            >
              <div className="relative">
                <ChmonitorLogo width={20} height={20} className="size-5" />
                {!showExpanded && (
                  <LogoStatusIndicator hostId={activeHost.id} />
                )}
              </div>
              {showExpanded && (
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {activeHost.name || getHost(activeHost.host)}
                  </span>
                  <HostVersionWithStatus hostId={activeHost.id} />
                </div>
              )}
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
      <AddHostDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
      <HostDetailsDialog
        host={detailsHost}
        open={detailsHost !== null}
        onOpenChange={(o) => {
          if (!o) setDetailsHost(null)
        }}
      />
    </>
  )
}
