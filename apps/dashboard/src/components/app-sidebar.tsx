import { BookOpenIcon } from 'lucide-react'
import { menuItemsConfig } from '@/menu'

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
import { isCloudModeClient } from '@/lib/cloud/cloud-mode'
import { DOCS_SITE_URL } from '@/lib/docs-site'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { filterMenuItemsByPermissions } from '@/lib/feature-permissions/menu'

export function AppSidebar() {
  const { config } = useFeaturePermissions()
  const cloudMode = isCloudModeClient()
  // Billing + Organization are cloud-only surfaces — self-hosting is free
  // forever and has no orgs, so these would only confuse self-hosters.
  const cloudOnlyHrefs = new Set(['/billing', '/organization'])
  const menuItems = filterMenuItemsByPermissions(
    menuItemsConfig,
    config
  ).filter((item) => cloudMode || !cloudOnlyHrefs.has(item.href))

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
            <SidebarMenuButton asChild size="sm" tooltip="Docs">
              <a href={DOCS_SITE_URL} target="_blank" rel="noopener noreferrer">
                <BookOpenIcon />
                <span>Docs</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser user={GUEST_USER} />
      </SidebarFooter>
    </Sidebar>
  )
}
