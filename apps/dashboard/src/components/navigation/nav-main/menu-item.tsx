import { ChevronRight } from 'lucide-react'

import type { HTMLAttributes, ReactNode, Ref } from 'react'
import type { MenuItem as MenuItemType } from '@/components/menu/types'
import type { UnavailableResolution } from '@/lib/menu/unavailable-visibility'
import type { MenuItemActiveState, MenuItemProps } from './types'

import { AddButton, SubAddButton } from './add-button'
import { CollapsedSubmenu } from './collapsed-submenu'
import { GroupCustomizeButton } from './group-customize-dialog'
import { GroupHoverFlyout, GroupTouchQuickLinks } from './group-quick-links'
import { HideButton, SubHideButton } from './hide-button'
import { PinButton, SubPinButton } from './pin-button'
import { lazy, Suspense, useEffect, useState } from 'react'
import {
  useGroupVisibility,
  useUnavailableVisibility,
} from '@/components/menu/hooks/use-unavailable-visibility'
import { HostPrefixedLink } from '@/components/menu/link-with-context'
import { getGroupHubHref } from '@/lib/menu/group-hub'
import { hiddenSiblingLeaves } from '@/lib/menu/hidden-siblings'
import { unavailableReasonText } from '@/lib/menu/unavailable-visibility'
import { useMenuWorkspaceCatalog } from '@/lib/menu/use-menu-workspace'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

/** Rail tooltip for one row: the title, plus the reason when it is dimmed. */
function unavailableTooltip(
  title: string,
  resolution: UnavailableResolution
): string {
  const reason = unavailableReasonText(resolution)
  return reason ? `${title} (${reason})` : title
}

/**
 * Badges hide on hover/focus so they never stack on the pin in the same
 * right-hand corner (#2769 follow-up). Pin is hover-only, so badges stay
 * visible at rest even when the item is favorited.
 */
const badgeHiddenClasses =
  'transition-opacity group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0'

const subBadgeHiddenClasses =
  'transition-opacity group-hover/menu-sub-item:opacity-0 group-focus-within/menu-sub-item:opacity-0'

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
  liProps,
  leadingAction,
}: {
  item: MenuItemType
  isActive: boolean
  liProps?: HTMLAttributes<HTMLLIElement> & { ref?: Ref<HTMLLIElement> }
  leadingAction?: ReactNode
}) {
  const closeMobileSidebar = useCloseMobileSidebar()
  const hostId = useHostId()
  const resolution = useUnavailableVisibility(item, hostId)
  const hasBadge = Boolean(item.isNew || item.countKey)
  const { catalog, hiddenHrefs } = useMenuWorkspaceCatalog()
  const hasAdd =
    Boolean(item.href) &&
    hiddenSiblingLeaves(catalog, item.href, hiddenHrefs).length > 0

  // Hide or dim per the one availability policy (#3463). A `tableCheck` page
  // whose backing table is missing can never work here, so under the default
  // Hide setting it leaves the rail entirely; a config-gated page is only dimmed
  // unless the item opts in. It stays routable by URL and explains itself there.
  if (resolution.visibility === 'hidden') {
    return null
  }
  const available = resolution.visibility === 'available'

  return (
    <SidebarMenuItem {...liProps}>
      {leadingAction}
      <SidebarMenuButton
        isActive={isActive}
        tooltip={unavailableTooltip(item.title, resolution)}
        className={cn(
          'h-11 min-h-11 cursor-pointer lg:h-8 lg:min-h-8',
          available ? '' : 'opacity-50 text-muted-foreground/50'
        )}
        render={
          <HostPrefixedLink
            href={item.href}
            className="flex w-full cursor-pointer items-center"
            onClick={closeMobileSidebar}
          />
        }
      >
        {item.icon && <item.icon className="size-4 shrink-0" />}
        <span
          className={cn(
            'min-w-0 truncate pr-12 group-data-[state=collapsed]/sidebar:hidden',
            hasBadge && hasAdd
              ? 'lg:pr-20'
              : hasAdd || hasBadge
                ? 'lg:pr-16'
                : undefined
          )}
        >
          {item.title}
        </span>
      </SidebarMenuButton>
      {item.href ? (
        <HideButton href={item.href} title={item.title} hasBadge={hasBadge} />
      ) : null}
      {item.href ? <AddButton href={item.href} hasBadge={hasBadge} /> : null}
      <PinButton href={item.href} title={item.title} hasBadge={hasBadge} />
      {item.isNew && (
        <SidebarMenuBadge className={badgeHiddenClasses}>
          <Suspense fallback={null}>
            <NewBadge href={item.href} isNew={item.isNew} />
          </Suspense>
        </SidebarMenuBadge>
      )}
      {item.countKey && (
        <SidebarMenuBadge className={badgeHiddenClasses}>
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
  const resolution = useUnavailableVisibility(subItem, hostId)
  const hasBadge = Boolean(subItem.isNew || subItem.countKey)
  const { catalog, hiddenHrefs } = useMenuWorkspaceCatalog()
  const hasAdd =
    Boolean(subItem.href) &&
    hiddenSiblingLeaves(catalog, subItem.href, hiddenHrefs).length > 0

  // Same policy as the leaf path above and the collapsed flyout (#3463).
  if (resolution.visibility === 'hidden') {
    return null
  }
  const available = resolution.visibility === 'available'

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        isActive={isMenuItemActiveAmongSiblings(
          subItem.href,
          siblingHrefs,
          pathname
        )}
        className={cn(
          'h-11 min-h-11 w-full cursor-pointer pr-12 lg:h-7 lg:min-h-7',
          hasAdd && 'lg:pr-16',
          hasBadge && (hasAdd ? 'lg:pr-20' : 'lg:pr-16'),
          available ? '' : 'opacity-50 text-muted-foreground/50'
        )}
        render={
          <HostPrefixedLink
            href={subItem.href}
            siblingHrefs={siblingHrefs}
            className="flex w-full cursor-pointer items-center gap-2"
            onClick={closeMobileSidebar}
          />
        }
      >
        <span className="group-data-[state=collapsed]/sidebar:hidden min-w-0 flex-1 truncate">
          {subItem.title}
        </span>
        {subItem.isNew && (
          <span className={cn('ml-auto flex shrink-0', subBadgeHiddenClasses)}>
            <Suspense fallback={null}>
              <NewBadge href={subItem.href} isNew={subItem.isNew} />
            </Suspense>
          </span>
        )}
        {subItem.countKey && (
          <span className={cn('ml-auto flex shrink-0', subBadgeHiddenClasses)}>
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
      {subItem.href ? (
        <SubHideButton
          href={subItem.href}
          title={subItem.title}
          hasBadge={hasBadge}
        />
      ) : null}
      {subItem.href ? (
        <SubAddButton href={subItem.href} hasBadge={hasBadge} />
      ) : null}
      <SubPinButton
        href={subItem.href}
        title={subItem.title}
        hasBadge={hasBadge}
      />
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
  const { resolution, visibleChildren } = useGroupVisibility(item, hostId)
  const siblingHrefs = visibleChildren.map((child) => child.href)
  const activeChildHref = item.items?.find(
    (child) => child.href && isMenuItemActive(child.href, pathname)
  )?.href
  const [open, setOpen] = useState(hasActiveChild)
  // Palette, breadcrumb, and in-page navigation onto a child must reveal
  // the active row.
  useEffect(() => {
    if (activeChildHref) setOpen(true)
  }, [activeChildHref])

  // AHEAD of the section element, in both sidebar states: a group whose own
  // page is unavailable, or whose every child is, must not render a heading
  // with a dangling chevron and an empty body. Same rule the product-design
  // skill records for data-dependent sections.
  if (resolution.visibility === 'hidden' || visibleChildren.length === 0) {
    return null
  }

  // When collapsed, use Popover submenu
  // Note: Badges stay inline with button content for collapsed state
  if (isCollapsed) {
    const triggerButton = (
      <SidebarMenuButton
        isActive={hasActiveChild}
        className="h-11 min-h-11 lg:h-8 lg:min-h-8"
      >
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

  const hubHref = getGroupHubHref(item.title)
  const isHubActive = Boolean(hubHref && isMenuItemActive(hubHref, pathname))

  // Standard shadcn/ui pattern: Collapsible wraps SidebarMenuItem.
  // A group with a hub splits the row: the label navigates to the hub, the
  // chevron (a sibling button — a <button> cannot nest inside the <a>) still
  // expands. Groups without a hub keep the whole row as the toggle.
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group/collapsible"
      render={<SidebarMenuItem />}
    >
      <GroupHoverFlyout
        groupTitle={item.title}
        visibleChildren={visibleChildren}
        onShowAll={() => setOpen(true)}
      >
      {hubHref ? (
        <>
          <SidebarMenuButton
            isActive={isHubActive || hasActiveChild}
            tooltip={item.title}
            className="h-11 min-h-11 lg:h-8 lg:min-h-8"
            render={
              <HostPrefixedLink
                href={hubHref}
                className="flex w-full cursor-pointer items-center"
                onClick={closeMobileSidebar}
              />
            }
          >
            {item.icon && <item.icon className="size-4" />}
            {/* pr-14 reserves the customize button and chevron slots. */}
            <span className="min-w-0 truncate pr-14">{item.title}</span>
          </SidebarMenuButton>
          <CollapsibleTrigger
            aria-label={`${open ? 'Collapse' : 'Expand'} ${item.title}`}
            data-testid="group-expand-button"
            className="absolute top-1/2 right-1 flex aspect-square w-6 -translate-y-1/2 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 group-data-[collapsible=icon]:hidden"
          >
            <ChevronRight className="size-4 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </CollapsibleTrigger>
        </>
      ) : (
        <CollapsibleTrigger
          render={
            <SidebarMenuButton
              isActive={hasActiveChild}
              tooltip={item.title}
              className="h-11 min-h-11 lg:h-8 lg:min-h-8"
            />
          }
        >
          {item.icon && <item.icon className="size-4" />}
          {/* pr-7 reserves the customize button's slot: it is an absolutely
            positioned sibling now (a <button> cannot nest inside the trigger's
            <button>), so it no longer takes flex space. */}
          <span className="min-w-0 truncate pr-7">{item.title}</span>
          <ChevronRight className="ml-auto shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
        </CollapsibleTrigger>
      )}
      </GroupHoverFlyout>
      <GroupCustomizeButton groupTitle={item.title} />
      {item.countKey && (
        <SidebarMenuBadge className={cn(badgeHiddenClasses, 'max-lg:hidden')}>
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
        <SidebarMenuSub className="ml-2.5 gap-0 py-0 pl-1.5">
          <GroupTouchQuickLinks
            visibleChildren={visibleChildren}
            onNavigate={closeMobileSidebar}
          />
          {visibleChildren.map((subItem) => (
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
export const MenuItem = function MenuItem({
  item,
  pathname,
  liProps,
  leadingAction,
}: MenuItemProps) {
  const hasChildren = item.items && item.items.length > 0
  const { isActive, hasActiveChild } = getMenuItemActiveState(item, pathname)

  if (!hasChildren) {
    return (
      <SingleMenuItem
        item={item}
        isActive={isActive}
        liProps={liProps}
        leadingAction={leadingAction}
      />
    )
  }

  return (
    <CollapsibleMenuItem
      item={item}
      pathname={pathname}
      hasActiveChild={hasActiveChild}
    />
  )
}
