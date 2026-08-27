import { Ellipsis, Search } from 'lucide-react'
import { menuItemsConfig } from '@/menu'

import { HiddenPageRows } from './hidden-page-rows'
import { useMemo, useState } from 'react'
import { useOpenSettings } from '@/components/settings/settings-dialog-provider'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { SETTINGS_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { isFeatureAllowed } from '@/lib/feature-permissions/shared'
import { useUserSettings } from '@/lib/hooks/use-user-settings'
import { hiddenLeavesGrouped } from '@/lib/menu/hidden-siblings'
import { useMenuWorkspaceCatalog } from '@/lib/menu/use-menu-workspace'
import {
  effectiveHiddenMenuHrefs,
  workspaceFromSettings,
} from '@/lib/menu/workspace-presets'
import { cn } from '@/lib/utils'

/**
 * More flyout: searchable hidden leaves, click navigates, hover Add / Pin.
 * Customize… opens Settings → Navigation. Show all applies Full. Empty
 * hide list hides the row. Below lg the catalog is an inline panel in the
 * overlay sidebar — not the 375 Settings dialog.
 */
export function MorePagesButton() {
  const { settings } = useUserSettings()
  const { isMobile, setOpenMobile } = useSidebar()
  const openSettings = useOpenSettings()
  const { config } = useFeaturePermissions()
  const canUseSettings = isFeatureAllowed(SETTINGS_FEATURE_PERMISSION, config)
  const hiddenCount = effectiveHiddenMenuHrefs(
    menuItemsConfig,
    workspaceFromSettings(settings)
  ).length
  const [open, setOpen] = useState(false)

  if (!canUseSettings || hiddenCount === 0) return null

  const closeOverlay = () => {
    setOpen(false)
    if (isMobile) setOpenMobile(false)
  }

  const trigger = (
    <SidebarMenuButton
      tooltip="Hidden pages"
      className="h-11 min-h-11 lg:h-8 lg:min-h-8 text-muted-foreground"
      data-testid="more-pages-button"
      onClick={isMobile ? () => setOpen((value) => !value) : undefined}
    >
      <Ellipsis className="size-4 shrink-0" strokeWidth={1.5} />
      <span>More</span>
    </SidebarMenuButton>
  )

  return (
    <SidebarGroup className="overflow-x-hidden p-1">
      <SidebarMenu>
        <SidebarMenuItem>
          {isMobile ? (
            <>
              {trigger}
              {open ? (
                <div
                  className="mt-1 min-w-0 overflow-x-hidden rounded-lg border border-border bg-popover p-1.5"
                  data-testid="more-pages-panel"
                >
                  <MoreCatalog
                    onClose={closeOverlay}
                    onCustomize={() => {
                      closeOverlay()
                      openSettings('navigation')
                    }}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger render={trigger} />
              <PopoverContent
                align="start"
                side="right"
                sideOffset={8}
                className="w-[min(20rem,calc(100vw-2rem))] max-h-[min(28rem,75vh)] overflow-x-hidden overflow-y-auto p-1.5"
                data-testid="more-pages-panel"
              >
                <MoreCatalog
                  onClose={closeOverlay}
                  onCustomize={() => {
                    closeOverlay()
                    openSettings('navigation')
                  }}
                />
              </PopoverContent>
            </Popover>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}

function MoreCatalog({
  onClose,
  onCustomize,
}: {
  onClose: () => void
  onCustomize: () => void
}) {
  const [query, setQuery] = useState('')
  const { catalog, hiddenHrefs, showHref, showAll } = useMenuWorkspaceCatalog()
  const groups = useMemo(() => {
    const all = hiddenLeavesGrouped(catalog, hiddenHrefs)
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.href.toLowerCase().includes(q) ||
            group.group.toLowerCase().includes(q)
        ),
      }))
      .filter((group) => group.items.length > 0)
  }, [catalog, hiddenHrefs, query])

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search hidden pages"
          className="h-9 pl-8 text-[13px] lg:h-8"
          data-testid="more-pages-search"
        />
      </div>
      <div className="max-h-[min(18rem,50vh)] overflow-x-hidden overflow-y-auto">
        {groups.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No hidden pages match.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.group} className="min-w-0">
              <p className="px-2 py-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                {group.group}
              </p>
              <HiddenPageRows
                items={group.items}
                mode="navigate"
                onAdd={showHref}
                onNavigate={onClose}
              />
            </div>
          ))
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 border-t border-border pt-1">
        <button
          type="button"
          data-testid="more-pages-customize"
          className={cn(
            'flex min-h-11 w-full items-center rounded-md px-2 text-left text-[13px] font-medium hover:bg-muted lg:min-h-8'
          )}
          onClick={onCustomize}
        >
          Customize…
        </button>
        <button
          type="button"
          data-testid="more-pages-show-all"
          className="flex min-h-11 w-full items-center rounded-md px-2 text-left text-[13px] font-medium hover:bg-muted lg:min-h-8"
          onClick={() => {
            showAll()
            onClose()
          }}
        >
          Show all
        </button>
      </div>
    </div>
  )
}
