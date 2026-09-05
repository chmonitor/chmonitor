import { PlusIcon } from 'lucide-react'

import { useState } from 'react'
import { AddHostDialog } from '@/components/connections'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

export function HostSwitcherEmptyAddHost({
  showExpanded,
}: {
  showExpanded: boolean
}) {
  const [addDialogOpen, setAddDialogOpen] = useState(false)

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
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
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
