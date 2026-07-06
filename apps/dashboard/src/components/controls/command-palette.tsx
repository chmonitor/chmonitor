'use client'

import {
  CornerDownLeft,
  Search,
  SearchX,
  Settings,
  Table,
  TextSearch,
} from 'lucide-react'

import { detectQuickNav, parseTableName } from './command-palette-utils'
import * as React from 'react'
import { useState } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { IconButton } from '@/components/ui/icon-button'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { getVisibleMenuItems } from '@/lib/menu/visible-items'
import { useRouter, useSearchParams } from '@/lib/next-compat'
import { buildUrl } from '@/lib/url/url-builder'
import { cn } from '@/lib/utils'

interface CommandPaletteProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onOpenSettings?: () => void
}

/** Small keycap used in the palette footer hints. */
function Kbd({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-sans text-[10px] font-medium text-muted-foreground',
        className
      )}
    >
      {children}
    </kbd>
  )
}

/**
 * Affordance shown on the right of the active row: a subtle "press Enter" hint
 * that only appears on the selected item (cmdk sets `data-selected="true"`).
 */
function EnterHint() {
  return (
    <span className="ml-auto flex items-center gap-1 pl-2 text-[10px] text-muted-foreground opacity-0 transition-opacity group-data-[selected=true]:opacity-100">
      <CornerDownLeft className="size-3" />
    </span>
  )
}

export const CommandPalette = function CommandPalette({
  open: controlledOpen,
  onOpenChange,
  onOpenSettings,
}: CommandPaletteProps = {}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [internalOpen, setInternalOpen] = React.useState(false)
  const [inputValue, setInputValue] = useState('')
  const { config } = useFeaturePermissions()
  const menuItems = getVisibleMenuItems(config)

  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to open
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setOpen(!open)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, setOpen])

  const hostId = searchParams.get('host') || '0'

  const navigate = (href: string) => {
    setOpen(false)
    setInputValue('')
    // External destinations (e.g. Docs → docs.chmonitor.dev) open in a new tab
    // instead of being routed through the SPA.
    if (/^https?:\/\//.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    const url = buildUrl(href, { host: hostId })
    router.push(url)
  }

  const {
    isQueryId,
    isTableName,
    hasMatch: showQuickNav,
  } = detectQuickNav(inputValue)

  const handleGoToQuery = () => {
    setOpen(false)
    setInputValue('')
    const url = buildUrl('/query', {
      host: hostId,
      query_id: inputValue.trim(),
    })
    router.push(url)
  }

  const handleOpenInExplorer = () => {
    setOpen(false)
    setInputValue('')
    const { database, table } = parseTableName(inputValue)
    const url = buildUrl('/explorer', {
      host: hostId,
      database,
      table,
    })
    router.push(url)
  }

  const handleOpenSettings = () => {
    setOpen(false)
    onOpenSettings?.()
  }

  // Top-level entries without sub-items (Overview, AI Agent, Insights, Health…)
  // are collapsed into a single "Go to" group so each one no longer renders its
  // own redundant single-item heading. Entries that have sub-items keep their
  // own group.
  const leafItems = menuItems.filter(
    (group) => !group.items || group.items.length === 0
  )
  const sectionedItems = menuItems.filter(
    (group) => group.items && group.items.length > 0
  )

  return (
    <>
      {/* Search icon button for small screens */}
      <IconButton
        icon={<Search className="size-4" />}
        onClick={() => setOpen(true)}
        tooltip="Search"
        className="md:hidden"
      />

      {/* Search trigger - hidden on mobile */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative hidden h-8 w-30 items-center gap-2 rounded-md border bg-muted/30 px-2.5 text-xs transition-[border-color,box-shadow,background-color] hover:bg-muted/50 hover:ring-1 hover:ring-primary/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 md:inline-flex md:w-40"
      >
        <Search aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">Search…</span>
        <kbd
          id="search-shortcut"
          className="ml-auto rounded border bg-muted px-1.5 text-[10px] font-medium"
        >
          ⌘K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) setInputValue('')
        }}
        aria-label="Command palette"
        showCloseButton={false}
        className="sm:max-w-2xl"
      >
        <CommandInput
          placeholder="Search pages, query id, or database.table…"
          aria-label="Search commands"
          value={inputValue}
          onValueChange={setInputValue}
        />
        <CommandList className="max-h-[60vh] scroll-py-2">
          <CommandEmpty>
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <SearchX className="size-6 text-muted-foreground/50" />
              <p className="text-sm font-medium">No results found</p>
              <p className="text-xs text-muted-foreground">
                Try a page name, a query id, or a{' '}
                <code className="font-mono">database.table</code> reference.
              </p>
            </div>
          </CommandEmpty>

          {showQuickNav && (
            <>
              <CommandGroup heading="Quick Navigation">
                {isQueryId && (
                  <CommandItem
                    onSelect={handleGoToQuery}
                    value={`query-id-${inputValue}`}
                    className="group"
                  >
                    <TextSearch className="size-4 shrink-0" />
                    <span>Go to query</span>
                    <span className="ml-1 truncate font-mono text-xs text-muted-foreground">
                      {inputValue.trim()}
                    </span>
                    <EnterHint />
                  </CommandItem>
                )}
                {isTableName && (
                  <CommandItem
                    onSelect={handleOpenInExplorer}
                    value={`explorer-${inputValue}`}
                    className="group"
                  >
                    <Table className="size-4 shrink-0" />
                    <span>Open in explorer</span>
                    <span className="ml-1 truncate font-mono text-xs text-muted-foreground">
                      {inputValue.trim()}
                    </span>
                    <EnterHint />
                  </CommandItem>
                )}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {leafItems.length > 0 && (
            <CommandGroup heading="Go to">
              {leafItems.map((group) => (
                <CommandItem
                  key={group.href}
                  onSelect={() => navigate(group.href)}
                  value={[group.title, group.description]
                    .filter(Boolean)
                    .join(' ')}
                  className="group"
                >
                  {group.icon && <group.icon className="size-4 shrink-0" />}
                  <span className="font-medium">{group.title}</span>
                  <EnterHint />
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {sectionedItems.map((group) => (
            <CommandGroup key={group.title} heading={group.title}>
              {group.items?.map((item) => (
                <CommandItem
                  key={item.href}
                  onSelect={() => navigate(item.href)}
                  value={[group.title, item.title, item.description]
                    .filter(Boolean)
                    .join(' ')}
                  className="group flex-col items-start gap-0.5"
                >
                  <div className="flex w-full items-center gap-2">
                    {item.icon && <item.icon className="size-4 shrink-0" />}
                    <span className="font-medium">{item.title}</span>
                    <EnterHint />
                  </div>
                  {item.description && (
                    <span className="w-full truncate pl-6 text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}

          {onOpenSettings && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Actions">
                <CommandItem
                  onSelect={handleOpenSettings}
                  value="Settings preferences"
                  className="group"
                >
                  <Settings className="size-4 shrink-0" />
                  <span>Settings</span>
                  <Kbd className="ml-auto">⌘,</Kbd>
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>

        {/* Footer with keyboard hints — the hallmark of a polished palette. */}
        <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span className="hidden sm:inline">navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <Kbd>
                <CornerDownLeft className="size-3" />
              </Kbd>
              <span className="hidden sm:inline">open</span>
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd>
              <span className="hidden sm:inline">close</span>
            </span>
          </div>
          <span className="font-medium text-muted-foreground/70">
            ClickHouse Monitor
          </span>
        </div>
      </CommandDialog>
    </>
  )
}
