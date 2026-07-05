import { ChevronRight } from 'lucide-react'

import type { MenuItem as MenuItemType } from '@/components/menu/types'
import type { MenuItemActiveState, MenuItemProps } from './types'

import { CollapsedSubmenu } from './collapsed-submenu'
import { lazy, Suspense } from 'react'
import { useIsTableAvailable } from '@/components/menu/hooks/use-table-availability'
import { HostPrefixedLink } from '@/components/menu/link-with-context'
import { useHostId } from '@/lib/swr'

const NewBadge = lazy(() =>
  import('@/components/menu/components/new-badge').then((mod) => ({
    default: mod.NewBadge,
  }))
)

const CountBadge = lazy(() =>
  import('@/components/menu/components/count-badge').then((mod) => ({
    default: mod.CountBadge,
  }))
)

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  isMenuItemActive,
  isMenuItemActiveAmongSiblings,
} from '@/lib/menu/breadcrumb'

function useCloseMobileSidebar() {
  const { isMobile, setOpenMobile } = useSidebar()

  return (event?: React.MouseEvent<HTMLAnchorElement>) => {
    if (!event?.defaultPrevented && isMobile) {
      setOpenMobile(false)
    }
  }
}

/**
 * Determines the active state for a menu item
 */
function getMenuItemActiveState(
  item: MenuItemType,
  pathname: string
): MenuItemActiveState {
  const isActive = isMenuItemActive(item.href, pathname)
  const hasChildren = item.items && item.items.length > 0

  const hasActiveChild =
    hasChildren && item.items
      ? item.items.some(
          (child) => child.href && isMenuItemActive(child.href, pathname)
        )
      : false

  return { isActive, hasActiveChild }
}

/**
 * Renders a single menu item without children
 */
const SingleMenuItem = function SingleMenuItem({
  item,
  isActive,
}: {
  item: MenuItemType
  isActive: boolean
}) {
  const closeMobileSidebar = useCloseMobileSidebar()
  const hostId = useHostId()
  const { available } = useIsTableAvailable(item.tableCheck, hostId)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={
          available
            ? item.title
            : `${item.title} (System table not found on this host)`
        }
        className={available ? '' : 'opacity-50 text-muted-foreground/50'}
        render={
          <HostPrefixedLink
            href={item.href}
            className="flex w-full items-center"
            onClick={closeMobileSidebar}
          />
        }
      >
        {item.icon && <item.icon className="size-4 shrink-0" />}
        <span className="group-data-[state=collapsed]/sidebar:hidden">
          {item.title}
        </span>
      </SidebarMenuButton>
      {item.isNew && (
        <SidebarMenuBadge>
          <Suspense fallback={null}>
            <NewBadge href={item.href} isNew={item.isNew} />
          </Suspense>
        </SidebarMenuBadge>
      )}
      {item.countKey && (
        <SidebarMenuBadge>
          <Suspense fallback={null}>
            <CountBadge
              countKey={item.countKey}
              countLabel={item.countLabel}
              countVariant={item.countVariant}
            />
          </Suspense>
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  )
}

/**
 * Renders a single sub-item under a collapsible menu
 */
const SubMenuItem = function SubMenuItem({
  subItem,
  pathname,
  hostId,
  siblingHrefs,
  closeMobileSidebar,
}: {
  subItem: MenuItemType
  pathname: string
  hostId: number
  siblingHrefs: string[]
  closeMobileSidebar: () => void
}) {
  const { available } = useIsTableAvailable(subItem.tableCheck, hostId)

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        isActive={isMenuItemActiveAmongSiblings(
          subItem.href,
          siblingHrefs,
          pathname
        )}
        className={available ? '' : 'opacity-50 text-muted-foreground/50'}
        render={
          <HostPrefixedLink
            href={subItem.href}
            siblingHrefs={siblingHrefs}
            className="flex w-full items-center gap-2"
            onClick={closeMobileSidebar}
          />
        }
      >
        <span className="group-data-[state=collapsed]/sidebar:hidden min-w-0 truncate">
          {subItem.title}
        </span>
        {subItem.isNew && (
          <span className="ml-auto flex shrink-0">
            <Suspense fallback={null}>
              <NewBadge href={subItem.href} isNew={subItem.isNew} />
            </Suspense>
          </span>
        )}
        {subItem.countKey && (
          <span className="ml-auto flex shrink-0">
            <Suspense fallback={null}>
              <CountBadge
                countKey={subItem.countKey}
                countLabel={subItem.countLabel}
                countVariant={subItem.countVariant}
              />
            </Suspense>
          </span>
        )}
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}

/**
 * Renders a menu item with children (collapsible)
 * Uses standard shadcn/ui pattern - entire button triggers toggle
 */
const CollapsibleMenuItem = function CollapsibleMenuItem({
  item,
  pathname,
  hasActiveChild,
}: {
  item: MenuItemType
  pathname: string
  hasActiveChild: boolean
}) {
  const { state } = useSidebar()
  const closeMobileSidebar = useCloseMobileSidebar()
  const hostId = useHostId()
  const isCollapsed = state === 'collapsed'
  const siblingHrefs = item.items?.map((child) => child.href) ?? []

  // When collapsed, use Popover submenu
  // Note: Badges stay inline with button content for collapsed state
  if (isCollapsed) {
    const triggerButton = (
      <SidebarMenuButton isActive={hasActiveChild}>
        {item.icon && <item.icon className="size-4" />}
        <span className="group-data-[state=collapsed]/sidebar:hidden">
          {item.title}
        </span>
        {item.countKey && (
          <span className="ml-auto group-data-[state=collapsed]/sidebar:hidden">
            <Suspense fallback={null}>
              <CountBadge
                countKey={item.countKey}
                countLabel={item.countLabel}
                countVariant={item.countVariant}
              />
            </Suspense>
          </span>
        )}
        <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=collapsed]/sidebar:hidden" />
      </SidebarMenuButton>
    )

    return (
      <SidebarMenuItem>
        <CollapsedSubmenu
          item={item}
          pathname={pathname}
          trigger={triggerButton}
        />
      </SidebarMenuItem>
    )
  }

  // Standard shadcn/ui pattern: Collapsible wraps SidebarMenuItem
  // Entire button (text + chevron) triggers toggle
  return (
    <Collapsible
      defaultOpen={hasActiveChild}
      className="group/collapsible"
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        render={
          <SidebarMenuButton isActive={hasActiveChild} tooltip={item.title} />
        }
      >
        {item.icon && <item.icon className="size-4" />}
        <span>{item.title}</span>
        <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
      </CollapsibleTrigger>
      {item.countKey && (
        <SidebarMenuBadge>
          <Suspense fallback={null}>
            <CountBadge
              countKey={item.countKey}
              countLabel={item.countLabel}
              countVariant={item.countVariant}
            />
          </Suspense>
        </SidebarMenuBadge>
      )}
      <CollapsibleContent>
        <SidebarMenuSub>
          {item.items?.map((subItem) => (
            <SubMenuItem
              key={subItem.href}
              subItem={subItem}
              pathname={pathname}
              hostId={hostId}
              siblingHrefs={siblingHrefs}
              closeMobileSidebar={closeMobileSidebar}
            />
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * MenuItem component - renders a single menu item or collapsible menu with children
 */
export const MenuItem = function MenuItem({ item, pathname }: MenuItemProps) {
  const hasChildren = item.items && item.items.length > 0
  const { isActive, hasActiveChild } = getMenuItemActiveState(item, pathname)

  if (!hasChildren) {
    return <SingleMenuItem item={item} isActive={isActive} />
  }

  return (
    <CollapsibleMenuItem
      item={item}
      pathname={pathname}
      hasActiveChild={hasActiveChild}
    />
  )
}
