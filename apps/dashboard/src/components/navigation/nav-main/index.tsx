import type { NavMainProps, NavRenderSection } from './types'

import { MenuGroup } from './menu-group'
import { NavFavorites } from './nav-favorites'
import { usePathname } from '@/lib/next-compat'

/**
 * NavMain component - main navigation sidebar with grouped menu items
 *
 * Renders menu sections (Main, Others) with their respective items.
 * Each section is only rendered if it contains items.
 *
 * @example
 * ```tsx
 * import { NavMain } from '@/components/navigation/nav-main'
 * import { menuItemsConfig } from '@/menu'
 *
 * export function AppSidebar() {
 *   return <NavMain items={menuItemsConfig} />
 * }
 * ```
 */
export function NavMain({ items }: NavMainProps) {
  const pathname = usePathname()
  const sections: NavRenderSection[] = ['main', 'others']

  return (
    <>
      <NavFavorites items={items} pathname={pathname} />
      {sections.map((section) => (
        <MenuGroup
          key={section}
          section={section}
          items={items}
          pathname={pathname}
        />
      ))}
    </>
  )
}
