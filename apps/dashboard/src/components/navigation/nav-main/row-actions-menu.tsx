import { ArrowDown, ArrowUp, EyeOff, MoreHorizontal, Pin } from 'lucide-react'

import { useHideMenuItem } from './hide-button'
import { createContext, useContext } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  useIsFavorite,
  useMoveFavorite,
  useToggleFavorite,
} from '@/hooks/use-favorites'
import { neighborHref } from '@/lib/menu/favorites-store'
import { cn } from '@/lib/utils'

/**
 * Rendered order of the Favorites group, or `null` outside it. A row that
 * finds an order is a favorite row and gets Move up / Move down. It is the
 * rendered order (not the stored pin list) so a stale pin never makes a
 * step look like a no-op.
 */
const FavoritesOrderContext = createContext<readonly string[] | null>(null)

export const FavoritesOrderProvider = FavoritesOrderContext.Provider

const itemClasses = 'min-h-11 gap-2 px-2'

interface RowActionsMenuProps {
  href: string
  title: string
  /** Step left of the absolute `isNew`/count badge on a top-level row. */
  hasBadge?: boolean
}

/**
 * Touch path to a sidebar page row's actions (#3580). Below `lg` there is no
 * hover, so the hover pin / hide / drag grip are replaced by one trailing "…"
 * button (36px target) opening a menu: Pin / Unpin, Hide from sidebar, and —
 * in the Favorites group — Move up / Move down. `lg`+ keeps the hover
 * buttons; this trigger is `lg:hidden`. A sibling of the row link, so it
 * never navigates. Keyboard: Enter / Space / ArrowDown open it, arrows move,
 * Escape closes (Base UI Menu).
 */
export function RowActionsMenu({ href, title, hasBadge }: RowActionsMenuProps) {
  const isPinned = useIsFavorite(href)
  const toggleFavorite = useToggleFavorite()
  const moveFavorite = useMoveFavorite()
  const hideMenuItem = useHideMenuItem()
  const favoritesOrder = useContext(FavoritesOrderContext)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="row-actions-trigger"
        aria-label="Page actions"
        title={`${title} actions`}
        className={cn(
          'absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:bg-sidebar-accent group-data-[collapsible=icon]:hidden lg:hidden',
          hasBadge && 'right-8'
        )}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          className={itemClasses}
          onClick={() => toggleFavorite(href)}
        >
          <Pin className={cn(isPinned && 'fill-current')} />
          {isPinned ? 'Unpin' : 'Pin'}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClasses}
          onClick={() => hideMenuItem(href, title)}
        >
          <EyeOff />
          Hide from sidebar
        </DropdownMenuItem>
        {favoritesOrder ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={itemClasses}
              disabled={neighborHref(favoritesOrder, href, 'up') === null}
              onClick={() => moveFavorite(href, 'up', favoritesOrder)}
            >
              <ArrowUp />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              className={itemClasses}
              disabled={neighborHref(favoritesOrder, href, 'down') === null}
              onClick={() => moveFavorite(href, 'down', favoritesOrder)}
            >
              <ArrowDown />
              Move down
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
