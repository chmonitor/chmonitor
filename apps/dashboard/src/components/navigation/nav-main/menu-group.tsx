import type { MenuGroupProps, NavRenderSection } from './types'

import { MenuItem } from './menu-item'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar'

/**
 * Section label mapping
 */
const SECTION_LABELS: Record<NavRenderSection, string> = {
  main: 'Main',
  others: 'Others',
}

/**
 * MenuGroup component - renders a section of menu items with a label
 */
export const MenuGroup = function MenuGroup({
  section,
  items,
  pathname,
}: MenuGroupProps) {
  // Filter items belonging to this section
  const sectionItems = items.filter((item) => item.section === section)

  // Don't render empty sections
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
