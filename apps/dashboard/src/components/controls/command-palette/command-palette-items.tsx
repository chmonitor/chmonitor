'use client'

import {
  CornerDownLeft,
  Database,
  GlobeIcon,
  History,
  Moon,
  Pin,
  Search,
  SearchX,
  Settings,
  Sparkles,
  Sun,
  Table,
  TextSearch,
} from 'lucide-react'

import type { ReactNode } from 'react'
import type { MenuItem } from '@/components/menu/types'
import type { RecentPaletteItemKind } from '@/lib/command-palette/recent-items'
import type { ExplorerTableRow } from './use-palette-groups'

import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { IconButton } from '@/components/ui/icon-button'
import { cn, getHost } from '@/lib/utils'

/**
 * The two ways to open the palette: an icon-only button for small screens,
 * and a "Search…" trigger with the ⌘K hint for md+ screens.
 */
export function CommandPaletteTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <IconButton
        icon={<Search className="size-4" />}
        onClick={onOpen}
        tooltip="Search"
        className="md:hidden"
      />

      <button
        type="button"
        onClick={onOpen}
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
    </>
  )
}

/** Small keycap used in the palette footer hints. */
export function Kbd({
  children,
  className,
}: {
  children: ReactNode
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
export function EnterHint() {
  return (
    <span className="ml-auto flex items-center gap-1 pl-2 text-[10px] text-muted-foreground opacity-0 transition-opacity group-data-[selected=true]:opacity-100">
      <CornerDownLeft className="size-3" />
    </span>
  )
}

interface RecentItem {
  id: string
  title: string
  href: string
  kind: RecentPaletteItemKind
  description?: string
}

interface MergedHostLike {
  id: number
  name?: string | null
  host: string
}

/**
 * The full palette result list: favorites, recent items, quick-navigation,
 * "Go to" (leaf menu entries), sectioned menu groups, databases, tables, and
 * the trailing Actions group (AI chat, theme toggle, host switch, settings).
 * All selection handlers are owned by the caller (`CommandPalette`) — this
 * component is purely presentational per-group row rendering.
 */
export function CommandPaletteResults({
  inputValue,
  favoriteMenuItems,
  onSelectFavorite,
  recentItems,
  onSelectRecent,
  quickNav,
  onGoToQuery,
  onOpenInExplorer,
  leafItems,
  sectionedItems,
  onSelectMenuItem,
  databases,
  tables,
  onSelectDatabase,
  onSelectTable,
  mounted,
  resolvedTheme,
  onToggleTheme,
  onOpenAiChat,
  otherHosts,
  onSwitchHost,
  onOpenSettings,
}: {
  inputValue: string
  favoriteMenuItems: readonly MenuItem[]
  onSelectFavorite: (item: MenuItem) => void
  recentItems: readonly RecentItem[]
  onSelectRecent: (item: RecentItem) => void
  quickNav: { isQueryId: boolean; isTableName: boolean; hasMatch: boolean }
  onGoToQuery: () => void
  onOpenInExplorer: () => void
  leafItems: readonly MenuItem[]
  sectionedItems: readonly MenuItem[]
  onSelectMenuItem: (item: MenuItem) => void
  databases: readonly string[]
  tables: readonly ExplorerTableRow[]
  onSelectDatabase: (database: string) => void
  onSelectTable: (row: ExplorerTableRow) => void
  mounted: boolean
  resolvedTheme: string | undefined
  onToggleTheme: () => void
  onOpenAiChat: () => void
  otherHosts: readonly MergedHostLike[]
  onSwitchHost: (id: number) => void
  onOpenSettings?: () => void
}) {
  return (
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

      {/* Pinned favorites (issue #2769) surface first, above Recent —
          cmdk's own value-based filter still narrows this group when the
          user types, so it isn't gated to the empty-query state. */}
      {favoriteMenuItems.length > 0 && (
        <>
          <CommandGroup heading="Favorites">
            {favoriteMenuItems.map((item) => (
              <CommandItem
                key={`favorite-${item.href}`}
                onSelect={() => onSelectFavorite(item)}
                value={`favorite ${[item.title, item.description]
                  .filter(Boolean)
                  .join(' ')}`}
                className="group"
              >
                <Pin className="size-4 shrink-0 fill-current text-muted-foreground" />
                <span className="font-medium">{item.title}</span>
                <EnterHint />
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
        </>
      )}

      {/* Recent items only make sense as a starting point — once the user
          is actively searching, cmdk's own filter takes over. */}
      {inputValue.length === 0 && recentItems.length > 0 && (
        <>
          <CommandGroup heading="Recent">
            {recentItems.map((recent) => (
              <CommandItem
                key={recent.id}
                onSelect={() => onSelectRecent(recent)}
                value={`recent-${recent.id}`}
                className="group"
              >
                <History className="size-4 shrink-0" />
                <span className="font-medium">{recent.title}</span>
                {recent.description && (
                  <span className="ml-1 truncate text-xs text-muted-foreground">
                    {recent.description}
                  </span>
                )}
                <EnterHint />
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
        </>
      )}

      {quickNav.hasMatch && (
        <>
          <CommandGroup heading="Quick Navigation">
            {quickNav.isQueryId && (
              <CommandItem
                onSelect={onGoToQuery}
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
            {quickNav.isTableName && (
              <CommandItem
                onSelect={onOpenInExplorer}
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
              onSelect={() => onSelectMenuItem(group)}
              value={[group.title, group.description].filter(Boolean).join(' ')}
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
              onSelect={() => onSelectMenuItem(item)}
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

      {databases.length > 0 && (
        <CommandGroup heading="Databases">
          {databases.map((database) => (
            <CommandItem
              key={`db-${database}`}
              onSelect={() => onSelectDatabase(database)}
              value={`database ${database}`}
              className="group"
            >
              <Database className="size-4 shrink-0" />
              <span className="font-medium">{database}</span>
              <EnterHint />
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {tables.length > 0 && (
        <CommandGroup heading="Tables">
          {tables.map((row) => (
            <CommandItem
              key={`table-${row.database}-${row.name}`}
              onSelect={() => onSelectTable(row)}
              value={`table ${row.database}.${row.name} ${row.engine}`}
              className="group"
            >
              <Table className="size-4 shrink-0" />
              <span className="font-medium">
                {row.database}.{row.name}
              </span>
              <span className="ml-1 truncate text-xs text-muted-foreground">
                {row.engine}
              </span>
              <EnterHint />
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      <CommandSeparator />
      <CommandGroup heading="Actions">
        <CommandItem
          onSelect={onOpenAiChat}
          value="Open AI Agent chat assistant"
          className="group"
        >
          <Sparkles className="size-4 shrink-0" />
          <span>Open AI Agent chat</span>
          <EnterHint />
        </CommandItem>

        {mounted && (
          <CommandItem
            onSelect={onToggleTheme}
            value="Toggle dark light theme appearance"
            className="group"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="size-4 shrink-0" />
            ) : (
              <Moon className="size-4 shrink-0" />
            )}
            <span>
              Switch to {resolvedTheme === 'dark' ? 'light' : 'dark'} mode
            </span>
            <EnterHint />
          </CommandItem>
        )}

        {otherHosts.map((host) => (
          <CommandItem
            key={`switch-host-${host.id}`}
            onSelect={() => onSwitchHost(host.id)}
            value={`switch host ${host.name || getHost(host.host)}`}
            className="group"
          >
            <GlobeIcon className="size-4 shrink-0" />
            <span>Switch to {host.name || getHost(host.host)}</span>
            <EnterHint />
          </CommandItem>
        ))}

        {onOpenSettings && (
          <CommandItem
            onSelect={onOpenSettings}
            value="Settings preferences"
            className="group"
          >
            <Settings className="size-4 shrink-0" />
            <span>Settings</span>
            <Kbd className="ml-auto">⌘,</Kbd>
          </CommandItem>
        )}
      </CommandGroup>
    </CommandList>
  )
}

/** Footer with keyboard hints — the hallmark of a polished palette. */
export function CommandPaletteFooter() {
  return (
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
  )
}
