/**
 * Dropdown menu list item component
 *
 * Displays individual items in the dropdown menu.
 */

import type { MenuItem } from '../types'

import { useMenuActiveState } from '../hooks/use-menu-active-state'
import { HostPrefixedLink } from '../link-with-context'
import { ActiveIndicator } from './active-indicator'
import { MenuIcon } from './menu-icon'
import { lazy, Suspense } from 'react'
import { NavigationMenuLink } from '@/components/ui/navigation-menu'
import { cn } from '@/lib/utils'

const CountBadge = lazy(() =>
  import('@/components/menu/count-badge').then((mod) => ({
    default: mod.CountBadge,
  }))
)

const NewBadge = lazy(() =>
  import('./new-badge').then((mod) => ({ default: mod.NewBadge }))
)

interface MenuListItemProps {
  item: MenuItem
  /** Hrefs of the other items rendered in the same dropdown list. */
  siblingHrefs?: string[]
}

export const MenuListItem = function MenuListItem({
  item,
  siblingHrefs,
}: MenuListItemProps) {
  const isActive = useMenuActiveState(item, siblingHrefs)

  const title = (
    <span className="flex flex-row items-center gap-1.5">
      <MenuIcon icon={item.icon} isActive={isActive} />
      <span>{item.title}</span>
      {item.countKey ? (
        <Suspense fallback={null}>
          <CountBadge countKey={item.countKey} variant={item.countVariant} />
        </Suspense>
      ) : null}
      <Suspense fallback={null}>
        <NewBadge href={item.href} isNew={item.isNew} />
      </Suspense>
    </span>
  )

  return (
    <li>
      <NavigationMenuLink
        render={
          <HostPrefixedLink
            href={item.href}
            siblingHrefs={siblingHrefs}
            className="group"
            data-active={isActive ? 'true' : undefined}
            data-testid={
              item.href === '/clusters'
                ? 'nav-clusters'
                : item.href === '/table'
                  ? 'nav-databases'
                  : undefined
            }
          />
        }
      >
        <div
          className={cn(
            'relative block space-y-0.5 rounded-md px-2.5 py-2 leading-none no-underline outline-hidden transition-colors select-none',
            'hover:bg-accent/60 hover:text-foreground',
            'focus:bg-accent/60 focus:text-foreground',
            'group-data-[active=true]:bg-accent/50 group-data-[active=true]:text-foreground'
          )}
        >
          <ActiveIndicator position="left" />
          <div className="overflow-hidden text-[13px] leading-tight font-medium text-ellipsis">
            {title}
          </div>
          <p className="text-muted-foreground line-clamp-1 text-xs leading-relaxed mt-0.5">
            {item.description}
          </p>
        </div>
      </NavigationMenuLink>
    </li>
  )
}
