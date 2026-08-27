import { ArrowUpRight, Plus } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

import { useRef, useState } from 'react'
import { HostPrefixedLink } from '@/components/menu/link-with-context'
import { useOpenSettings } from '@/components/settings/settings-dialog-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SidebarMenuAction } from '@/components/ui/sidebar'
import {
  catalogGroupLeaves,
  findCatalogGroupByTitle,
} from '@/lib/menu/hidden-siblings'
import { useMenuWorkspaceCatalog } from '@/lib/menu/use-menu-workspace'
import { cn } from '@/lib/utils'

interface GroupCustomizeButtonProps {
  groupTitle: string
}

/**
 * Hover + on a parent group heading. Opens a dialog of every catalog child
 * in that group — Add (`showMenuHref`) / Remove (`hideMenuHref`) without
 * navigating. Overview (no children) never renders this.
 */
export function GroupCustomizeButton({
  groupTitle,
}: GroupCustomizeButtonProps) {
  const [open, setOpen] = useState(false)
  const { catalog } = useMenuWorkspaceCatalog()
  const group = findCatalogGroupByTitle(catalog, groupTitle)
  if (!catalogGroupLeaves(group).length) return null

  return (
    <>
      <SidebarMenuAction
        type="button"
        showOnHover
        data-testid="group-customize-button"
        data-group={groupTitle}
        className="right-1 after:-inset-3 [&>svg]:size-3 md:after:hidden"
        aria-label={`Customize ${groupTitle}`}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen(true)
        }}
      >
        <Plus />
      </SidebarMenuAction>
      <GroupCustomizeDialog
        open={open}
        onOpenChange={setOpen}
        groupTitle={groupTitle}
      />
    </>
  )
}

export function GroupCustomizeDialog({
  open,
  onOpenChange,
  groupTitle,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupTitle: string
}) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const openSettings = useOpenSettings()
  const { catalog } = useMenuWorkspaceCatalog()
  const leaves = catalogGroupLeaves(
    findCatalogGroupByTitle(catalog, groupTitle)
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(36rem,85vh)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        data-testid="group-customize-dialog"
        initialFocus={titleRef}
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3">
          <DialogTitle ref={titleRef} tabIndex={-1}>
            {groupTitle}
          </DialogTitle>
          <DialogDescription>
            Add or remove pages in this group.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2">
          <ul className="flex min-w-0 flex-col">
            {leaves.map((item) => (
              <GroupPageRow key={item.href} item={item} />
            ))}
          </ul>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 items-center gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            data-testid="group-customize-all-pages"
            className="min-h-11 w-full sm:min-h-8 sm:w-auto"
            onClick={() => {
              onOpenChange(false)
              openSettings('navigation', { focusGroup: groupTitle })
            }}
          >
            All pages…
          </Button>
          <Button
            type="button"
            data-testid="group-customize-done"
            className="min-h-11 w-full sm:min-h-8 sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GroupPageRow({ item }: { item: MenuItem }) {
  const { hiddenHrefs, showHref, hideHref } = useMenuWorkspaceCatalog()
  const [hidden, setHidden] = useState(() => hiddenHrefs.has(item.href))
  const Icon = item.icon

  return (
    <li
      className={cn(
        'flex min-w-0 items-center gap-0.5',
        hidden && 'text-muted-foreground'
      )}
    >
      <button
        type="button"
        data-testid={hidden ? 'group-customize-add' : 'group-customize-remove'}
        data-href={item.href}
        data-hidden={hidden ? 'true' : 'false'}
        aria-label={
          hidden
            ? `Add ${item.title} to the sidebar`
            : `Remove ${item.title} from the sidebar`
        }
        className={cn(
          'flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-muted lg:min-h-8',
          hidden && 'opacity-60'
        )}
        onClick={() => {
          if (hidden) {
            showHref(item.href)
            setHidden(false)
          } else {
            hideHref(item.href)
            setHidden(true)
          }
        }}
      >
        {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
        <span className="min-w-0 truncate">{item.title}</span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {hidden ? 'Add' : 'Remove'}
        </span>
      </button>
      <HostPrefixedLink
        href={item.href}
        aria-label={`Open ${item.title}`}
        data-testid="group-customize-open"
        data-href={item.href}
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:size-8"
      >
        <ArrowUpRight className="size-3.5" />
      </HostPrefixedLink>
    </li>
  )
}
