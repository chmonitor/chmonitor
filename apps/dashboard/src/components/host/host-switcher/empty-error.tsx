import { ChevronsUpDown, PlusIcon } from 'lucide-react'

import { useState } from 'react'
import { AddHostDialog } from '@/components/connections'
import { ChmonitorLogo } from '@/components/icons/chmonitor-logo'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

export function HostSwitcherEmptyError({
  showExpanded,
  isUnauthorized,
}: {
  showExpanded: boolean
  isUnauthorized: boolean
}) {
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  const { label, hint } = isUnauthorized
    ? { label: 'Sign in to load hosts', hint: 'Authentication required' }
    : { label: "Couldn't load hosts", hint: 'Refresh the page or add a host' }

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
                  <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
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
