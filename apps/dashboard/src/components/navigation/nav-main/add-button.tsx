import { Plus } from 'lucide-react'

import { HiddenPageRows } from './hidden-page-rows'
import { useState } from 'react'
import { useOpenSettings } from '@/components/settings/settings-dialog-provider'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SidebarMenuAction } from '@/components/ui/sidebar'
import {
  findCatalogGroupForHref,
  hiddenSiblingLeaves,
} from '@/lib/menu/hidden-siblings'
import { useMenuWorkspaceCatalog } from '@/lib/menu/use-menu-workspace'
import { cn } from '@/lib/utils'

interface AddButtonProps {
  href: string
  hasBadge?: boolean
}

/**
 * Hover + on a rail leaf: hidden siblings in that catalog group. Primary
 * click adds the leaf (`showMenuHref`); the arrow opens the page without
 * un-hiding. Footer Customize… opens Settings → Navigation, focused on
 * the group when cheap.
 */
export function AddButton({ href, hasBadge }: AddButtonProps) {
  const [open, setOpen] = useState(false)
  const openSettings = useOpenSettings()
  const { catalog, hiddenHrefs, showHref } = useMenuWorkspaceCatalog()
  const siblings = hiddenSiblingLeaves(catalog, href, hiddenHrefs)
  const groupTitle = findCatalogGroupForHref(catalog, href)?.title

  if (!href || siblings.length === 0) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <SidebarMenuAction
            type="button"
            showOnHover
            data-testid="add-menu-item"
            className={cn(
              'right-12 max-lg:hidden [&>svg]:size-3',
              hasBadge && 'right-16'
            )}
            aria-label="Add a hidden page in this group"
          />
        }
      >
        <Plus />
      </PopoverTrigger>
      <AddPopoverBody
        setOpen={setOpen}
        siblings={siblings}
        groupTitle={groupTitle}
        showHref={showHref}
        openSettings={openSettings}
      />
    </Popover>
  )
}

export function SubAddButton({ href, hasBadge }: AddButtonProps) {
  const [open, setOpen] = useState(false)
  const openSettings = useOpenSettings()
  const { catalog, hiddenHrefs, showHref } = useMenuWorkspaceCatalog()
  const siblings = hiddenSiblingLeaves(catalog, href, hiddenHrefs)
  const groupTitle = findCatalogGroupForHref(catalog, href)?.title

  if (!href || siblings.length === 0) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-testid="add-menu-item"
            aria-label="Add a hidden page in this group"
            className={cn(
              'absolute top-1/2 right-12 flex aspect-square size-5 -translate-y-1/2 items-center justify-center rounded-md p-0 text-sidebar-foreground opacity-0 outline-hidden transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:opacity-100 group-data-[collapsible=icon]:hidden max-lg:hidden',
              hasBadge && 'right-16'
            )}
          />
        }
      >
        <Plus className="size-3" />
      </PopoverTrigger>
      <AddPopoverBody
        setOpen={setOpen}
        siblings={siblings}
        groupTitle={groupTitle}
        showHref={showHref}
        openSettings={openSettings}
      />
    </Popover>
  )
}

function AddPopoverBody({
  setOpen,
  siblings,
  groupTitle,
  showHref,
  openSettings,
}: {
  setOpen: (open: boolean) => void
  siblings: ReturnType<typeof hiddenSiblingLeaves>
  groupTitle: string | undefined
  showHref: (href: string) => void
  openSettings: ReturnType<typeof useOpenSettings>
}) {
  return (
    <PopoverContent
      align="start"
      side="right"
      sideOffset={8}
      className="w-[min(18rem,calc(100vw-2rem))] max-h-[min(24rem,70vh)] overflow-x-hidden overflow-y-auto p-1.5"
    >
      <HiddenPageRows
        items={siblings}
        mode="add"
        onAdd={(nextHref) => {
          showHref(nextHref)
          setOpen(false)
        }}
      />
      <button
        type="button"
        data-testid="add-menu-customize"
        className="mt-1 flex min-h-11 w-full items-center rounded-md px-2 text-left text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground lg:min-h-8"
        onClick={() => {
          setOpen(false)
          openSettings('navigation', { focusGroup: groupTitle })
        }}
      >
        Customize…
      </button>
    </PopoverContent>
  )
}
