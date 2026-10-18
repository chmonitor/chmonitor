import type { MenuItem } from '../types'

import { useMenuActiveState } from '../hooks/use-menu-active-state'
import { HostPrefixedLink } from '../link-with-context'
import { ActiveIndicator } from './active-indicator'
import { MenuIcon } from './menu-icon'
import { lazy, Suspense } from 'react'
import { NavigationMenuItem } from '@/components/ui/navigation-menu'
import { cn } from '@/lib/utils'

const CountBadge = lazy(() =>
  import('@/components/menu/count-badge').then((mod) => ({
    default: mod.CountBadge,
  }))
)

interface MenuSingleItemProps {
  item: MenuItem
}

export const MenuSingleItem = function MenuSingleItem({
  item,
}: MenuSingleItemProps) {
  const isActive = useMenuActiveState(item)

  return (
    <NavigationMenuItem role="none">
      <HostPrefixedLink
        href={item.href}
        className={cn(
          'group relative inline-flex h-10 w-max items-center justify-center px-3 text-[13px] font-medium transition-colors',
          'text-muted-foreground hover:text-foreground',
          'focus:text-foreground focus:outline-hidden',
          'disabled:pointer-events-none disabled:opacity-50',
          'data-[active=true]:text-foreground data-[active=true]:font-semibold'
        )}
        data-active={isActive ? 'true' : undefined}
        aria-label={`Navigate to ${item.title}`}
        data-testid={
          item.href === '/clusters'
            ? 'nav-clusters'
            : item.href === '/table'
              ? 'nav-databases'
              : undefined
        }
      >
        <div className="flex flex-row items-center gap-1.5">
          <MenuIcon icon={item.icon} isActive={isActive} />
          <span>{item.title}</span>
          {item.countKey ? (
            <Suspense fallback={null}>
              <CountBadge
                countKey={item.countKey}
                variant={item.countVariant}
              />
            </Suspense>
          ) : null}
        </div>
        <ActiveIndicator position="bottom" />
      </HostPrefixedLink>
    </NavigationMenuItem>
  )
}
