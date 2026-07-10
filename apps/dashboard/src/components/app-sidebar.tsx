import { BookOpenIcon } from 'lucide-react'

import { HostSwitcher } from '@/components/host/host-switcher'
import { SampleClusterBanner } from '@/components/host/sample-cluster-banner'
import { NavUser } from '@/components/nav-user'
import { NavMain } from '@/components/navigation/nav-main'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { GUEST_USER } from '@/lib/clerk/guest-user'
import { DOCS_SITE_URL } from '@/lib/docs-site'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { useActiveHostEngine } from '@/lib/hooks/use-active-pg-connection'
import { getVisibleMenuItems } from '@/lib/menu/visible-items'

export function AppSidebar() {
  const { config } = useFeaturePermissions()
  // Feature-permission + cloud-only (Billing/Organization) + engine gates
  // resolved in one place — see lib/menu/visible-items.ts. The active engine
  // swaps the menu to Postgres pages when a Postgres source is selected (#2450).
  const engine = useActiveHostEngine()
  const menuItems = getVisibleMenuItems(config, engine)

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <HostSwitcher />
        <SampleClusterBanner />
      </SidebarHeader>

      <SidebarContent>
        <NavMain items={menuItems} />
      </SidebarContent>

      <SidebarFooter>
        {/* Small Docs link sitting just above the user button. Docs live on
            the external site (docs.chmonitor.dev), so this leaves the app. */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              tooltip="Docs"
              render={
                <a
                  href={DOCS_SITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <BookOpenIcon />
                  <span>Docs</span>
                </a>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser user={GUEST_USER} />
      </SidebarFooter>
    </Sidebar>
  )
}
