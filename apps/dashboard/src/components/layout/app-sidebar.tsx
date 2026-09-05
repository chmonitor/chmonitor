import { BookOpenIcon } from 'lucide-react'
import { useLocation } from '@tanstack/react-router'

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
import { isMenuItemActive } from '@/lib/menu/breadcrumb'
import { useVisibleMenuItems } from '@/lib/menu/use-visible-menu-items'

export function AppSidebar() {
  // Feature-permission + cloud-only + engine + workspace gates, plus Alerts
  // when notifications are active — see useVisibleMenuItems.
  const menuItems = useVisibleMenuItems()
  // Footer nav rows (Billing / Organization / About). Same visibility pipeline
  // as the body, so cloud-only + permission + engine gating still applies; they
  // render as compact rows in the footer instead of a labelled body group.
  const footerItems = menuItems.filter((item) => item.section === 'footer')
  const pathname = useLocation({ select: (l) => l.pathname })

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="gap-1 p-1.5">
        <HostSwitcher />
        <SampleClusterBanner />
      </SidebarHeader>

      {/* Row actions extend a 44px hit area past the right edge on the
          touch overlay; keep that from becoming a sideways scroll. */}
      <SidebarContent className="overflow-x-hidden">
        <NavMain items={menuItems} />
      </SidebarContent>

      <SidebarFooter className="p-1.5 pt-0">
        {/* App-level links (Billing / Organization / About) and the external
            Docs link share ONE menu so every footer row has the same rhythm —
            separate SidebarMenu blocks would pick up the footer's gap-2 and
            drift apart. Rows use the default SidebarMenuButton size (same as
            the body menu in nav-main/menu-item.tsx) so the footer reads as a
            continuation of the menu list, not a separate compact widget. The
            user button below stays its own block.
            Laid out as a 2-col grid (2x2 for the full 4-item set) so the
            footer stops eating vertical space the main menu needs on short
            screens; collapsed icon mode reverts to a single column since the
            3rem icon rail only has room for one icon per row. */}
        <SidebarMenu className="grid grid-cols-2 gap-0.5 group-data-[collapsible=icon]:grid-cols-1 group-data-[collapsible=icon]:gap-0">
          {footerItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                isActive={isMenuItemActive(item.href, pathname)}
                tooltip={item.title}
                className="h-11 min-h-11 lg:h-8 lg:min-h-8"
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
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Docs"
              className="h-11 min-h-11 lg:h-8 lg:min-h-8"
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
