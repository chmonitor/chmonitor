import type { MenuItem as MenuItemType } from '@/components/menu/types'

import { lazy, Suspense, useState } from 'react'
import { ClientOnly } from '@/components/client-only'
import { useIsTableAvailable } from '@/components/menu/hooks/use-table-availability'
import { HostPrefixedLink } from '@/components/menu/link-with-context'
import { useMetadataDbSatisfied } from '@/lib/menu/metadata-db'
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
  trigger: React.ReactNode
}

/**
 * CollapsedSubMenuItem - Renders a single sub-item in the collapsed popover
 * with async table-availability visual muting.
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
  const { available: tableAvailable } = useIsTableAvailable(
    subItem.tableCheck,
    hostId
  )
  const dbSatisfied = useMetadataDbSatisfied(subItem)
  const available = tableAvailable && dbSatisfied
  const isActive = isMenuItemActiveAmongSiblings(
    subItem.href,
    siblingHrefs,
    pathname
  )

  return (
    <HostPrefixedLink
      href={subItem.href}
      className={available ? '' : 'opacity-50'}
      title={
        available
          ? undefined
          : dbSatisfied
            ? 'System table not found on this host'
            : 'Requires a metadata database — configure D1 or Postgres'
      }
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

/**
 * CollapsedSubmenu - Renders submenu in a Popover for collapsed sidebar mode
 *
 * Features:
 * - Hover to open popover
 * - Click to toggle popover state
 * - Closes on click outside or Escape key
 * - Shows active state for child items
 */
export const CollapsedSubmenu = function CollapsedSubmenu({
  item,
  pathname,
  trigger,
}: CollapsedSubmenuProps) {
  const [open, setOpen] = useState(false)
  const { isMobile, setOpenMobile } = useSidebar()
  const hostId = useHostId()
  const hasChildren = item.items && item.items.length > 0
  const siblingHrefs = item.items?.map((child) => child.href) ?? []

  if (!hasChildren) {
    return <>{trigger}</>
  }

  // Wrap in ClientOnly to prevent hydration mismatch from Radix Popover IDs
  return (
    <ClientOnly fallback={<div className="cursor-pointer">{trigger}</div>}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <div
              role="button"
              tabIndex={0}
              onMouseEnter={() => setOpen(true)}
              onMouseLeave={() => setOpen(false)}
              onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)}
              className="cursor-pointer"
            />
          }
        >
          {trigger}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="right"
          sideOffset={4}
          className="w-56 p-1"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <div className="flex flex-col gap-0.5">
            {item.items?.map((subItem) => (
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
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </ClientOnly>
  )
}
