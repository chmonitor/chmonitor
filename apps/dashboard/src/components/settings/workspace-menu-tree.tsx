import { ChevronRight } from 'lucide-react'

import type { MenuItem, MenuSection } from '@/components/menu/types'

import { useMemo } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import { menuItemIsHidden } from '@/lib/menu/workspace-presets'
import { cn } from '@/lib/utils'

const SECTION_LABELS: Record<Exclude<MenuSection, 'footer'>, string> = {
  main: 'Main',
  others: 'Others',
}

const SECTIONS: Exclude<MenuSection, 'footer'>[] = ['main', 'others']

const menuButtonClass =
  'flex h-8 w-full items-center justify-start gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0'

/**
 * Settings tree sits outside a real Sidebar, so SidebarMenuSubButton's
 * `w-full` / `pr-7` do not stretch the row. Local classes: full width,
 * left-aligned label, Hide on the right. Do not change the live sidebar.
 */
const subLeafButtonClass =
  'flex h-7 w-full min-w-0 items-center justify-start gap-2 overflow-hidden rounded-md px-2 text-left text-sm ring-sidebar-ring outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2'

interface WorkspaceMenuTreeProps {
  items: readonly MenuItem[]
  hiddenHrefs: ReadonlySet<string>
  query: string
  /** Remount groups collapsed when the role pill changes. */
  resetKey?: string
  onToggle: (href: string, hidden: boolean) => void
}

export function WorkspaceMenuTree({
  items,
  hiddenHrefs,
  query,
  resetKey = '',
  onToggle,
}: WorkspaceMenuTreeProps) {
  const filtered = useMemo(() => filterMenuTree(items, query), [items, query])
  const searching = Boolean(query.trim())

  return (
    <div
      className="max-h-[min(22rem,50vh)] overflow-y-auto rounded-lg border border-border bg-sidebar text-sidebar-foreground"
      data-testid="workspace-menu-tree"
    >
      {SECTIONS.map((section) => {
        const sectionItems = filtered.filter(
          (item) => (item.section ?? 'main') === section
        )
        if (sectionItems.length === 0) return null

        return (
          <SidebarGroup key={section}>
            <SidebarGroupLabel className="px-3 py-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              {SECTION_LABELS[section]}
            </SidebarGroupLabel>
            <SidebarMenu>
              {sectionItems.map((item) => (
                <TreeNode
                  key={`${resetKey}:${item.title}`}
                  item={item}
                  hiddenHrefs={hiddenHrefs}
                  forceOpen={searching}
                  resetKey={resetKey}
                  onToggle={onToggle}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )
      })}
    </div>
  )
}

function TreeNode({
  item,
  hiddenHrefs,
  forceOpen,
  resetKey,
  onToggle,
}: {
  item: MenuItem
  hiddenHrefs: ReadonlySet<string>
  forceOpen: boolean
  resetKey: string
  onToggle: (href: string, hidden: boolean) => void
}) {
  const hasChildren = Boolean(item.items?.length)
  if (!hasChildren) {
    return <LeafRow item={item} hiddenHrefs={hiddenHrefs} onToggle={onToggle} />
  }

  const hidden = menuItemIsHidden(item, hiddenHrefs)

  return (
    <Collapsible
      key={forceOpen ? `${item.title}-search` : `${resetKey}:${item.title}`}
      defaultOpen={forceOpen}
      className="group/collapsible"
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        className={cn(menuButtonClass, hidden && mutedItemClass)}
        data-testid={`workspace-menu-group-${item.title}`}
        data-hidden={hidden ? 'true' : 'false'}
      >
        {item.icon && <item.icon className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
        <ChevronRight className="ml-auto size-4 shrink-0 transition-transform duration-200 group-data-open/collapsible:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted={forceOpen}>
        <SidebarMenuSub className="w-full">
          {item.items?.map((child) => (
            <SubLeafRow
              key={child.href || child.title}
              item={child}
              hiddenHrefs={hiddenHrefs}
              onToggle={onToggle}
            />
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
}

function LeafRow({
  item,
  hiddenHrefs,
  onToggle,
}: {
  item: MenuItem
  hiddenHrefs: ReadonlySet<string>
  onToggle: (href: string, hidden: boolean) => void
}) {
  const hidden = menuItemIsHidden(item, hiddenHrefs)

  return (
    <SidebarMenuItem>
      <button
        type="button"
        data-testid={`workspace-menu-leaf-${item.href}`}
        data-hidden={hidden ? 'true' : 'false'}
        aria-pressed={!hidden}
        aria-label={
          hidden ? `Show ${item.title} in the sidebar` : `Hide ${item.title}`
        }
        onClick={() => onToggle(item.href, hidden)}
        className={cn(menuButtonClass, hidden && mutedItemClass)}
      >
        {item.icon && <item.icon className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {hidden ? 'Show' : 'Hide'}
        </span>
      </button>
    </SidebarMenuItem>
  )
}

function SubLeafRow({
  item,
  hiddenHrefs,
  onToggle,
}: {
  item: MenuItem
  hiddenHrefs: ReadonlySet<string>
  onToggle: (href: string, hidden: boolean) => void
}) {
  if (item.items?.length) {
    return (
      <SidebarMenuSubItem className="w-full">
        <div className="px-2 py-1 text-left text-[11px] font-medium text-muted-foreground">
          {item.title}
        </div>
        <SidebarMenuSub className="w-full">
          {item.items.map((child) => (
            <SubLeafRow
              key={child.href || child.title}
              item={child}
              hiddenHrefs={hiddenHrefs}
              onToggle={onToggle}
            />
          ))}
        </SidebarMenuSub>
      </SidebarMenuSubItem>
    )
  }

  const hidden = menuItemIsHidden(item, hiddenHrefs)

  return (
    <SidebarMenuSubItem className="w-full">
      <button
        type="button"
        data-testid={`workspace-menu-leaf-${item.href}`}
        data-hidden={hidden ? 'true' : 'false'}
        data-align="start"
        aria-pressed={!hidden}
        aria-label={
          hidden ? `Show ${item.title} in the sidebar` : `Hide ${item.title}`
        }
        onClick={() => onToggle(item.href, hidden)}
        className={cn(subLeafButtonClass, hidden && mutedItemClass)}
      >
        <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {hidden ? 'Show' : 'Hide'}
        </span>
      </button>
    </SidebarMenuSubItem>
  )
}

const mutedItemClass = 'opacity-50 text-muted-foreground/50'

function filterMenuTree(items: readonly MenuItem[], query: string): MenuItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items.map((item) => ({ ...item }))

  return items.flatMap((item) => {
    const selfMatch =
      item.title.toLowerCase().includes(q) ||
      item.href.toLowerCase().includes(q)
    if (item.items?.length) {
      const children = filterMenuTree(item.items, query)
      if (children.length > 0) return [{ ...item, items: children }]
      if (selfMatch) return [{ ...item }]
      return []
    }
    return selfMatch ? [item] : []
  })
}
