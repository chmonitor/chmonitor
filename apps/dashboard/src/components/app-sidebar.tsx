import { BookOpenIcon } from 'lucide-react'

import { HostSwitcher } from '@/components/host/host-switcher'
import { SampleClusterBanner } from '@/components/host/sample-cluster-banner'
import { HostPrefixedLink } from '@/components/menu/link-with-context'
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
import { isMenuItemActive } from '@/lib/menu/breadcrumb'
import { getVisibleMenuItems } from '@/lib/menu/visible-items'
import { usePathname } from '@/lib/next-compat'

export function AppSidebar() {
  const { config } = useFeaturePermissions()
  // Feature-permission + cloud-only (Billing/Organization) + engine gates
  // resolved in one place — see lib/menu/visible-items.ts. The active engine
  // swaps the menu to Postgres pages when a Postgres source is selected (#2450).
  const engine = useActiveHostEngine()
  const menuItems = getVisibleMenuItems(config, engine)
  // Footer nav rows (Billing / Organization / About). Same visibility pipeline
  // as the body, so cloud-only + permission + engine gating still applies; they
  // render as compact rows in the footer instead of a labelled body group.
  const footerItems = menuItems.filter((item) => item.section === 'footer')
  const pathname = usePathname()

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
        {/* App-level links (Billing / Organization / About) as compact footer
            rows, above the Docs link and user button. */}
        {footerItems.length > 0 && (
          <SidebarMenu>
            {footerItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  size="sm"
                  isActive={isMenuItemActive(item.href, pathname)}
                  tooltip={item.title}
                  render={
                    <HostPrefixedLink
                      href={item.href}
                      className="flex w-full items-center"
                    />
                  }
                >
                  {item.icon && <item.icon className="size-4 shrink-0" />}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        )}
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
