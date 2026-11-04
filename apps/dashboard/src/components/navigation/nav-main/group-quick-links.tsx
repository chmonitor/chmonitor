import { ChevronRight, Clock, Pin } from 'lucide-react'

import type { ReactNode } from 'react'
import type { MenuItem as MenuItemType } from '@/components/menu/types'

import { useEffect, useMemo, useState } from 'react'
import { PagePinToggle } from '@/components/menu/components/page-pin-toggle'
import {
  useRecentPages,
  useRecordRecentPage,
} from '@/components/menu/hooks/use-recent-pages'
import { HostPrefixedLink } from '@/components/menu/link-with-context'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { useFavoriteHrefs } from '@/hooks/use-favorites'
import { getGroupHubHref } from '@/lib/menu/group-hub'
import { buildGroupPageIndex } from '@/lib/menu/group-page-index'
import {
  buildGroupQuickLinks,
  type GroupQuickLinks,
} from '@/lib/menu/recent-pages'
import { useMenuWorkspaceCatalog } from '@/lib/menu/use-menu-workspace'
import { cn } from '@/lib/utils'

const HOVER_QUERY = '(hover: hover) and (pointer: fine)'

/** True when the primary pointer can hover. False on SSR and touch devices. */
function useCanHover(): boolean {
  const [canHover, setCanHover] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia?.(HOVER_QUERY)
    if (!mql) return
    const onChange = () => setCanHover(mql.matches)
    onChange()
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [])
  return canHover
}

function useGroupQuickLinks(
  visibleChildren: readonly MenuItemType[]
): GroupQuickLinks {
  useRecordRecentPage()
  const favoriteHrefs = useFavoriteHrefs()
  const recent = useRecentPages()
  return useMemo(
    () => buildGroupQuickLinks(visibleChildren, favoriteHrefs, recent),
    [visibleChildren, favoriteHrefs, recent]
  )
}

const rowClass =
  'flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground'

function Section({
  label,
  icon,
  items,
  onNavigate,
}: {
  label: string
  icon?: ReactNode
  items: MenuItemType[]
  onNavigate?: () => void
}) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      {items.map((item) => (
        <HostPrefixedLink
          key={item.href}
          href={item.href}
          className={rowClass}
          onClick={onNavigate}
        >
          {item.icon ? (
            <item.icon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          <span className="truncate">{item.title}</span>
        </HostPrefixedLink>
      ))}
    </div>
  )
}

/** Pinned / Recent rows for the collapsed rail and the touch group body. */
export function GroupQuickSections({
  links,
  onNavigate,
}: {
  links: GroupQuickLinks
  onNavigate?: () => void
}) {
  return (
    <>
      <Section
        label="Pinned"
        icon={<Pin className="size-3" />}
        items={links.pinned}
        onNavigate={onNavigate}
      />
      <Section
        label="Recent"
        icon={<Clock className="size-3" />}
        items={links.recent}
        onNavigate={onNavigate}
      />
    </>
  )
}

/** Collapsed-rail variant: pinned/recent only; the full list follows it. */
export function CollapsedGroupQuickSections({
  visibleChildren,
  onNavigate,
}: {
  visibleChildren: readonly MenuItemType[]
  onNavigate?: () => void
}) {
  const links = useGroupQuickLinks(visibleChildren)
  if (links.pinned.length === 0 && links.recent.length === 0) return null
  return (
    <div
      className="mb-1 flex flex-col gap-1 border-b pb-1"
      data-testid="group-quick-links"
    >
      <GroupQuickSections links={links} onNavigate={onNavigate} />
    </div>
  )
}

/**
 * Every page of the group: pinned first, then pages in the sidebar, then the
 * pages hidden from it (muted). Each row carries a pin toggle.
 */
export function GroupAllPages({
  pages,
  onNavigate,
}: {
  pages: readonly MenuItemType[]
  onNavigate?: () => void
}) {
  const favoriteHrefs = useFavoriteHrefs()
  const { hiddenHrefs } = useMenuWorkspaceCatalog()
  const entries = useMemo(
    () => buildGroupPageIndex(pages, favoriteHrefs, hiddenHrefs),
    [pages, favoriteHrefs, hiddenHrefs]
  )
  if (entries.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5" data-testid="group-all-pages">
      <div className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
        All pages
      </div>
      <ul className="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto">
        {entries.map(({ item, inSidebar }) => (
          <li key={item.href} className="group/page-row relative">
            <HostPrefixedLink
              href={item.href}
              className={cn(
                rowClass,
                'pr-8',
                !inSidebar && 'text-muted-foreground'
              )}
              onClick={onNavigate}
            >
              {item.icon ? (
                <item.icon className="size-3.5 shrink-0 text-muted-foreground" />
              ) : null}
              <span className="truncate">{item.title}</span>
            </HostPrefixedLink>
            <PagePinToggle
              href={item.href}
              title={item.title}
              className="absolute top-1/2 right-1 size-6 -translate-y-1/2"
              unpinnedClassName="pointer-fine:opacity-0 pointer-fine:group-hover/page-row:opacity-100 pointer-fine:group-focus-within/page-row:opacity-100"
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Hover flyout around an expanded-rail group row: Recent, then every page of
 * the group, then the hub link. On touch devices it renders `children`
 * untouched.
 */
export function GroupHoverFlyout({
  groupTitle,
  pages,
  children,
}: {
  groupTitle: string
  /** The whole group, including pages hidden from the sidebar. */
  pages: readonly MenuItemType[]
  children: ReactNode
}) {
  const canHover = useCanHover()
  const links = useGroupQuickLinks(pages)
  const [open, setOpen] = useState(false)
  if (!canHover) return <>{children}</>

  const hubHref = getGroupHubHref(groupTitle)
  const close = () => setOpen(false)

  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger delay={150} closeDelay={100} render={<div />}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-64 p-1 motion-reduce:animate-none"
        data-testid="group-hover-flyout"
      >
        <div className="flex flex-col gap-1">
          <Section
            label="Recent"
            icon={<Clock className="size-3" />}
            items={links.recent}
            onNavigate={close}
          />
          <GroupAllPages pages={pages} onNavigate={close} />
          {hubHref ? (
            <div className="mt-0.5 border-t pt-1">
              <HostPrefixedLink
                href={hubHref}
                className={rowClass}
                onClick={close}
              >
                <span className="truncate">Open {groupTitle} hub</span>
                <ChevronRight className="ml-auto size-3.5 shrink-0" />
              </HostPrefixedLink>
            </div>
          ) : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

/**
 * Touch-device substitute for the flyout: pinned/recent rows at the top of the
 * expanded group. Renders nothing on hover-capable devices or with no history.
 */
export function GroupTouchQuickLinks({
  visibleChildren,
  onNavigate,
}: {
  visibleChildren: readonly MenuItemType[]
  onNavigate?: () => void
}) {
  const canHover = useCanHover()
  const links = useGroupQuickLinks(visibleChildren)
  if (canHover) return null
  if (links.pinned.length === 0 && links.recent.length === 0) return null
  return (
    <li
      className="mb-1 flex flex-col gap-1 border-b pb-1"
      data-testid="group-touch-quick-links"
    >
      <GroupQuickSections links={links} onNavigate={onNavigate} />
    </li>
  )
}
