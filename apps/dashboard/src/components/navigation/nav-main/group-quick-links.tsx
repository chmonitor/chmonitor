/**
 * Group quick links: pinned + recently visited pages of one sidebar group.
 *
 * - Desktop (hover-capable pointer): {@link GroupHoverFlyout} wraps the group
 *   row and opens a hover card after 150ms; keyboard focus opens it too.
 * - Touch: no hover exists, so {@link GroupTouchQuickLinks} lists the same
 *   pinned/recent rows at the top of the expanded group instead.
 * - Collapsed rail: `collapsed-submenu.tsx` renders {@link GroupQuickSections}
 *   above its full page list.
 */

import { ChevronRight, Clock, Pin } from 'lucide-react'

import type { ReactNode } from 'react'
import type { MenuItem as MenuItemType } from '@/components/menu/types'

import { useEffect, useMemo, useState } from 'react'
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
import {
  buildGroupQuickLinks,
  type GroupQuickLinks,
} from '@/lib/menu/recent-pages'
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

/** Pinned / Recent / (empty-state) top pages. Shared by every surface. */
export function GroupQuickSections({
  links,
  showFallback = true,
  onNavigate,
}: {
  links: GroupQuickLinks
  showFallback?: boolean
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
      {showFallback ? (
        <Section
          label="Top pages"
          items={links.fallback}
          onNavigate={onNavigate}
        />
      ) : null}
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
      <GroupQuickSections
        links={links}
        showFallback={false}
        onNavigate={onNavigate}
      />
    </div>
  )
}

/**
 * Hover flyout around an expanded-rail group row. On touch devices it renders
 * `children` untouched.
 */
export function GroupHoverFlyout({
  groupTitle,
  visibleChildren,
  onShowAll,
  children,
}: {
  groupTitle: string
  visibleChildren: readonly MenuItemType[]
  /** Expands the group in place ("All N pages"). */
  onShowAll: () => void
  children: ReactNode
}) {
  const canHover = useCanHover()
  const links = useGroupQuickLinks(visibleChildren)
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
        className="w-60 p-1 motion-reduce:animate-none"
        data-testid="group-hover-flyout"
      >
        <div className="flex flex-col gap-1">
          <GroupQuickSections links={links} onNavigate={close} />
          <div className="mt-0.5 flex flex-col gap-0.5 border-t pt-1">
            {hubHref ? (
              <HostPrefixedLink
                href={hubHref}
                className={rowClass}
                onClick={close}
              >
                <span className="truncate">Open {groupTitle} hub</span>
                <ChevronRight className="ml-auto size-3.5 shrink-0" />
              </HostPrefixedLink>
            ) : null}
            <button
              type="button"
              className={cn(rowClass, 'w-full text-left text-muted-foreground')}
              onClick={() => {
                onShowAll()
                close()
              }}
            >
              All {visibleChildren.length} pages
            </button>
          </div>
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
      <GroupQuickSections
        links={links}
        showFallback={false}
        onNavigate={onNavigate}
      />
    </li>
  )
}
