import { LogoStatusIndicatorSkeleton } from '../logo-status-indicator'
import { ChmonitorLogo } from '@/components/icons/chmonitor-logo'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function HostSwitcherLoadingSkeleton({
  showExpanded,
}: {
  showExpanded: boolean
}) {
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
