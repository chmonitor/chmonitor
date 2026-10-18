import type { MenuGroupProps, NavRenderSection } from './types'

import { MenuItem } from './menu-item'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar'

const SECTION_LABELS: Record<NavRenderSection, string> = {
  main: 'Main',
  others: 'Others',
}

export const MenuGroup = function MenuGroup({
  section,
  items,
  pathname,
}: MenuGroupProps) {
  const sectionItems = items.filter((item) => item.section === section)

  if (sectionItems.length === 0) {
    return null
  }

  const label = SECTION_LABELS[section]

  return (
    <SidebarGroup className="p-1">
      <SidebarGroupLabel className="h-7 px-2 py-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </SidebarGroupLabel>
      <SidebarMenu>
        {sectionItems.map((item) => (
          <MenuItem key={item.title} item={item} pathname={pathname} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
