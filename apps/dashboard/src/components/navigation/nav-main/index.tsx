import { useLocation } from '@tanstack/react-router'

import type { NavMainProps, NavRenderSection } from './types'

import { MenuGroup } from './menu-group'
import { MorePagesButton } from './more-pages-button'
import { NavFavorites } from './nav-favorites'

export function NavMain({ items }: NavMainProps) {
  const pathname = useLocation({ select: (l) => l.pathname })
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
      <MorePagesButton />
    </>
  )
}
