import { menuItemsConfig } from '@/menu'

import type { MenuItem } from './types'

import { MenuHasChildren } from './components/menu-has-children'
import { MenuSingleItem } from './components/menu-single-item'
import {
  NavigationMenu,
  NavigationMenuList,
} from '@/components/ui/navigation-menu'

export interface MenuProps {
  items?: MenuItem[]
  className?: string
}

export const MenuNavigationStyle = function MenuNavigationStyle({
  items = menuItemsConfig,
  className,
}: MenuProps) {
  return (
    <NavigationMenu className={className} aria-label="Main navigation">
      <NavigationMenuList role="menubar">
        {items.map((item) => (
          <MenuItemComponent key={item.title} item={item} />
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  )
}

const MenuItemComponent = function MenuItemComponent({
  item,
}: {
  item: MenuItem
}) {
  if (item.items) {
    return <MenuHasChildren item={item} />
  }

  return <MenuSingleItem item={item} />
}
