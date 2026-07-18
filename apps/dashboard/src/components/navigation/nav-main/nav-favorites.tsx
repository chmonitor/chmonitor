import type { MenuItem as MenuItemType } from '@/components/menu/types'

import { MenuItem } from './menu-item'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar'
import { useFavoriteHrefs } from '@/hooks/use-favorites'
import { getFavoriteMenuItems } from '@/lib/menu/derive-favorites'

interface NavFavoritesProps {
  /** Full menu tree (all sections) — favorites are resolved by href across
   * every section, including nested sub-items. */
  items: MenuItemType[]
  pathname: string
}

/**
 * "Favorites" group — pinned menu items in pin order, rendered above the
 * regular Main/Others sections. Hidden entirely when there are no favorites
 * (issue #2769). Favorites are derived from the live menu tree by href, so a
 * pinned route that got renamed or removed is dropped silently instead of
 * rendering a broken link.
 */
export function NavFavorites({ items, pathname }: NavFavoritesProps) {
  const favoriteHrefs = useFavoriteHrefs()
  const favoriteItems = getFavoriteMenuItems(items, favoriteHrefs)

  if (favoriteItems.length === 0) {
    return null
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2">
        Favorites
      </SidebarGroupLabel>
      <SidebarMenu>
        {favoriteItems.map((item) => (
          <MenuItem key={item.href} item={item} pathname={pathname} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
