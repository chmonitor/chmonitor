import type { MenuItem as MenuItemType } from '@/components/menu/types'

import { lazy, Suspense, useState } from 'react'
import { ClientOnly } from '@/components/layout/client-only'
import {
  useGroupVisibility,
  useUnavailableVisibility,
} from '@/components/menu/hooks/use-unavailable-visibility'
import { HostPrefixedLink } from '@/components/menu/link-with-context'
import { groupChildrenBySubgroup } from '@/lib/menu/subgroups'
import { unavailableReasonText } from '@/lib/menu/unavailable-visibility'
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

import { CollapsedGroupQuickSections } from './group-quick-links'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useSidebar } from '@/components/ui/sidebar'
import { isMenuItemActiveAmongSiblings } from '@/lib/menu/breadcrumb'
import { cn } from '@/lib/utils'

interface CollapsedSubmenuProps {
  item: MenuItemType
  pathname: string
  trigger: React.ReactElement
}

/**
 * CollapsedSubMenuItem - Renders a single sub-item in the collapsed popover,
 * with the same hide-or-dim decision the expanded rail makes.
 */
const CollapsedSubMenuItem = function CollapsedSubMenuItem({
  subItem,
  pathname,
  hostId,
  siblingHrefs,
  isMobile,
  setOpenMobile,
  setOpen,
}: {
  subItem: MenuItemType
  pathname: string
  hostId: number
  siblingHrefs: string[]
  isMobile: boolean
  setOpenMobile: (open: boolean) => void
  setOpen: (open: boolean) => void
}) {
  const resolution = useUnavailableVisibility(subItem, hostId)
  const isActive = isMenuItemActiveAmongSiblings(
    subItem.href,
    siblingHrefs,
    pathname
  )

  // The expanded rail already drops these rows, so the flyout must too —
  // two surfaces disagreeing is worse than either behaviour.
  if (resolution.visibility === 'hidden') {
    return null
  }
  const available = resolution.visibility === 'available'

  return (
    <HostPrefixedLink
      href={subItem.href}
      className={available ? '' : 'opacity-50'}
      title={unavailableReasonText(resolution) ?? undefined}
      onClick={() => {
        setOpen(false)
        if (isMobile) {
          setOpenMobile(false)
        }
      }}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-2',
          'rounded-sm px-2 py-1.5 text-sm outline-hidden transition-colors hover:bg-accent hover:text-accent-foreground',
          'focus-visible:bg-accent focus-visible:text-accent-foreground',
          isActive && 'bg-accent text-accent-foreground'
        )}
      >
        <span className="truncate">{subItem.title}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Suspense fallback={null}>
            <NewBadge href={subItem.href} isNew={subItem.isNew} />
          </Suspense>
          {subItem.countKey && (
            <Suspense fallback={null}>
              <CountBadge
                countKey={subItem.countKey}
                countLabel={subItem.countLabel}
                countVariant={subItem.countVariant}
              />
            </Suspense>
          )}
        </span>
      </div>
    </HostPrefixedLink>
  )
}

export const CollapsedSubmenu = function CollapsedSubmenu({
  item,
  pathname,
  trigger,
}: CollapsedSubmenuProps) {
  const [open, setOpen] = useState(false)
  const { isMobile, setOpenMobile } = useSidebar()
  const hostId = useHostId()
  // Same visible set as the expanded rail (menu-item.tsx), so both rails agree
  // on which rows exist and which sibling hrefs take part in active-row choice.
  const { visibleChildren } = useGroupVisibility(item, hostId)
  const hasChildren = visibleChildren.length > 0
  const siblingHrefs = visibleChildren.map((child) => child.href)

  if (!hasChildren) {
    return <>{trigger}</>
  }

  // Wrap in ClientOnly to prevent hydration mismatch from Radix Popover IDs
  return (
    <ClientOnly fallback={<div className="cursor-pointer">{trigger}</div>}>
      <Popover open={open} onOpenChange={setOpen}>
        {/* Hover handlers live on a plain wrapper so the trigger itself is the
            real <button> — a role=button div wrapping it would nest
            interactives and trip the nativeButton warning. */}
        <div
          className="cursor-pointer"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <PopoverTrigger render={trigger} />
        </div>
        <PopoverContent
          align="start"
          side="right"
          sideOffset={4}
          className="w-56 p-1"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <CollapsedGroupQuickSections
            visibleChildren={visibleChildren}
            onNavigate={() => {
              setOpen(false)
              if (isMobile) setOpenMobile(false)
            }}
          />
          {/* One scrolling flyout: subgroup headings are plain labels, never
              nested popovers. */}
          <div className="flex max-h-[70vh] flex-col gap-0.5 overflow-y-auto">
            {groupChildrenBySubgroup(visibleChildren).map((section) => {
              const rows = section.items.map((subItem) => (
                <CollapsedSubMenuItem
                  key={subItem.href}
                  subItem={subItem}
                  pathname={pathname}
                  hostId={hostId}
                  siblingHrefs={siblingHrefs}
                  isMobile={isMobile}
                  setOpenMobile={setOpenMobile}
                  setOpen={setOpen}
                />
              ))
              if (!section.subgroup) return rows
              return (
                <div
                  key={`subgroup:${section.subgroup}`}
                  role="group"
                  aria-label={section.subgroup}
                  data-testid="collapsed-subgroup"
                  className="flex flex-col gap-0.5"
                >
                  <div
                    aria-hidden="true"
                    className="px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground"
                  >
                    {section.subgroup}
                  </div>
                  {rows}
                </div>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </ClientOnly>
  )
}
