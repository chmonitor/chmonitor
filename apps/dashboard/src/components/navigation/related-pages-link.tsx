import { ChevronRight } from 'lucide-react'

import { useState } from 'react'
import { HiddenPageRows } from '@/components/navigation/nav-main/hidden-page-rows'
import { useOpenSettings } from '@/components/settings/settings-dialog-provider'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  findCatalogGroupForHref,
  hiddenSiblingLeaves,
} from '@/lib/menu/hidden-siblings'
import { useMenuWorkspaceCatalog } from '@/lib/menu/use-menu-workspace'
import { cn } from '@/lib/utils'

/**
 * Modest More / Customize on a key page header. Lists hidden siblings in
 * the same catalog group, or opens Settings → Navigation for that group.
 */
export function RelatedPagesLink({
  href,
  className,
}: {
  href: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const openSettings = useOpenSettings()
  const { catalog, hiddenHrefs, showHref } = useMenuWorkspaceCatalog()
  const siblings = hiddenSiblingLeaves(catalog, href, hiddenHrefs)
  const groupTitle = findCatalogGroupForHref(catalog, href)?.title

  const openCustomize = () => {
    setOpen(false)
    openSettings('navigation', { focusGroup: groupTitle })
  }

  if (siblings.length === 0) {
    return (
      <button
        type="button"
        data-testid="related-pages-customize"
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
          className
        )}
        onClick={openCustomize}
      >
        Customize
        <ChevronRight className="size-3.5" />
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-testid="related-pages-more"
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
              className
            )}
          />
        }
      >
        More
        <ChevronRight className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(18rem,calc(100vw-2rem))] max-h-[min(24rem,70vh)] overflow-x-hidden overflow-y-auto p-1.5"
      >
        <HiddenPageRows items={siblings} mode="navigate" onAdd={showHref} />
        <button
          type="button"
          data-testid="related-pages-customize"
          className="mt-1 flex min-h-11 w-full items-center rounded-md px-2 text-left text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground lg:min-h-8"
          onClick={openCustomize}
        >
          Customize…
        </button>
      </PopoverContent>
    </Popover>
  )
}
