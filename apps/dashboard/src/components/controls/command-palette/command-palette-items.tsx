'use client'

import type { LucideIcon } from 'lucide-react'
import {
  CornerDownLeft,
  Database,
  FileText,
  GlobeIcon,
  History,
  LayoutList,
  Moon,
  Pin,
  Search,
  SearchX,
  Settings,
  Sparkles,
  Sun,
  Table,
  TextSearch,
  Zap,
} from 'lucide-react'

import type { ReactNode } from 'react'
import type { MenuItem } from '@/components/menu/types'
import type { RecentPaletteItemKind } from '@/lib/command-palette/recent-items'
import type { PaletteTab } from '../command-palette-utils'
import type { ExplorerTableRow } from './use-palette-groups'

import { menuItemPaletteValue } from '../command-palette-utils'
import { HighlightText } from './highlight-text'
import { EXPLORER_GROUP_MAX } from './use-palette-groups'
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
 * The two ways to open the palette: an icon-only button below `lg`, and a
 * "Search…" trigger with the ⌘K hint once the desktop rail is up. Showing
 * the 160px field at `md` (768) was crowding the header title to "Over…".
 */
export function CommandPaletteTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <IconButton
        icon={<Search className="size-4" />}
        onClick={onOpen}
        tooltip="Search"
        className="min-h-11 min-w-11 lg:hidden"
      />

      <button
        type="button"
        onClick={onOpen}
        className="relative hidden h-8 w-40 items-center gap-2 rounded-md border bg-muted/30 px-2.5 text-xs transition-[border-color,box-shadow,background-color] hover:bg-muted/50 hover:ring-1 hover:ring-primary/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 lg:inline-flex"
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

/** Titles stay one line (`TTL & Partitions` must not wrap on `&`). */
const TITLE_CLASS = 'font-medium whitespace-nowrap shrink-0'
/** Trailing meta on the same row: ellipsis instead of wrapping the title. */
const META_CLASS = 'ml-1 min-w-0 flex-1 truncate text-xs text-muted-foreground'

function HiddenHint({ hidden }: { hidden: boolean }) {
  if (!hidden) return null
  return (
    <span
      data-testid="palette-hidden-hint"
      className="ml-1 shrink-0 text-[10px] font-medium text-muted-foreground"
    >
      Hidden
    </span>
  )
}

export const PALETTE_TABS: {
  value: PaletteTab
  label: string
  icon: LucideIcon
}[] = [
  { value: 'all', label: 'All', icon: LayoutList },
  { value: 'pages', label: 'Pages', icon: FileText },
  { value: 'databases', label: 'Databases', icon: Database },
  { value: 'tables', label: 'Tables', icon: Table },
  { value: 'actions', label: 'Actions', icon: Zap },
]

export function CommandPaletteTabs({
  value,
  onChange,
}: {
  value: PaletteTab
  onChange: (tab: PaletteTab) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Search category"
      className="scrollbar-hide flex w-full min-w-0 gap-1 overflow-x-auto border-b px-3 pt-1.5"
    >
      {PALETTE_TABS.map((tab) => {
        const Icon = tab.icon
        const active = value === tab.value
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
              active
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.5} />
            {tab.label}
          </button>
        )
      })}
    </div>
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
 * pages (tree), databases, tables, and the trailing Actions group.
 * Category tabs hide whole groups so keyboard nav only walks the active tab.
 */
export function CommandPaletteResults({
  inputValue,
  tab,
  favoriteMenuItems,
  onSelectFavorite,
  recentItems,
  onSelectRecent,
  quickNav,
  onGoToQuery,
  onOpenInExplorer,
  leafItems,
  sectionedItems,
  hiddenHrefs,
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
  tab: PaletteTab
  favoriteMenuItems: readonly MenuItem[]
  onSelectFavorite: (item: MenuItem) => void
  recentItems: readonly RecentItem[]
  onSelectRecent: (item: RecentItem) => void
  quickNav: { isQueryId: boolean; isTableName: boolean; hasMatch: boolean }
  onGoToQuery: () => void
  onOpenInExplorer: () => void
  leafItems: readonly MenuItem[]
  sectionedItems: readonly MenuItem[]
  hiddenHrefs?: ReadonlySet<string>
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
  const showAll = tab === 'all'
  const showPages = showAll || tab === 'pages'
  const showDatabases = showAll || tab === 'databases'
  const showTables = showAll || tab === 'tables'
  const showActions = showAll || tab === 'actions'
  const showChrome = showAll
  const listedDatabases = showAll
    ? databases.slice(0, EXPLORER_GROUP_MAX)
    : databases
  const listedTables = showAll ? tables.slice(0, EXPLORER_GROUP_MAX) : tables

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
      {showChrome && favoriteMenuItems.length > 0 && (
        <>
          <CommandGroup heading="Favorites">
            {favoriteMenuItems.map((item) => (
              <CommandItem
                key={`favorite-${item.href}`}
                onSelect={() => onSelectFavorite(item)}
                value={`favorite ${menuItemPaletteValue(item)}`}
                className="group min-w-0"
              >
                <Pin className="size-4 shrink-0 fill-current text-muted-foreground" />
                <HighlightText
                  text={item.title}
                  query={inputValue}
                  className={TITLE_CLASS}
                />
                <EnterHint />
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
        </>
      )}

      {/* Recent items only make sense as a starting point — once the user
          is actively searching, cmdk's own filter takes over. */}
      {showChrome && inputValue.length === 0 && recentItems.length > 0 && (
        <>
          <CommandGroup heading="Recent">
            {recentItems.map((recent) => (
              <CommandItem
                key={recent.id}
                onSelect={() => onSelectRecent(recent)}
                value={`recent-${recent.id}`}
                className="group min-w-0"
              >
                <History className="size-4 shrink-0" />
                <HighlightText
                  text={recent.title}
                  query={inputValue}
                  className={TITLE_CLASS}
                />
                {recent.description && (
                  <HighlightText
                    text={recent.description}
                    query={inputValue}
                    className={META_CLASS}
                  />
                )}
                <EnterHint />
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
        </>
      )}

      {showChrome && quickNav.hasMatch && (
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

      {showPages && leafItems.length > 0 && (
        <CommandGroup heading="Go to">
          {leafItems.map((group) => (
            <CommandItem
              key={group.href}
              onSelect={() => onSelectMenuItem(group)}
              value={menuItemPaletteValue(group)}
              className={cn(
                'group min-w-0',
                hiddenHrefs?.has(group.href) && 'text-muted-foreground'
              )}
            >
              {group.icon && <group.icon className="size-4 shrink-0" />}
              <HighlightText
                text={group.title}
                query={inputValue}
                className={TITLE_CLASS}
              />
              <HiddenHint hidden={Boolean(hiddenHrefs?.has(group.href))} />
              <EnterHint />
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {showPages &&
        sectionedItems.map((group) => (
          <CommandGroup
            key={group.title}
            heading={group.title}
            className="[&_[cmdk-group-items]]:ml-3 [&_[cmdk-group-items]]:border-l [&_[cmdk-group-items]]:border-border [&_[cmdk-group-items]]:pl-2.5"
          >
            {group.items?.map((item) => (
              <CommandItem
                key={item.href}
                onSelect={() => onSelectMenuItem(item)}
                value={menuItemPaletteValue(item, group.title)}
                className={cn(
                  'group flex-col items-start gap-0.5 rounded-md',
                  hiddenHrefs?.has(item.href) && 'text-muted-foreground'
                )}
              >
                <div className="flex w-full min-w-0 items-center gap-2">
                  {item.icon && <item.icon className="size-4 shrink-0" />}
                  <HighlightText
                    text={item.title}
                    query={inputValue}
                    className={TITLE_CLASS}
                  />
                  <HiddenHint hidden={Boolean(hiddenHrefs?.has(item.href))} />
                  <EnterHint />
                </div>
                {item.description && (
                  <HighlightText
                    text={item.description}
                    query={inputValue}
                    className="w-full truncate pl-6 text-xs text-muted-foreground"
                  />
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

      {showDatabases && listedDatabases.length > 0 && (
        <CommandGroup heading="Databases">
          {listedDatabases.map((database) => (
            <CommandItem
              key={`db-${database}`}
              onSelect={() => onSelectDatabase(database)}
              value={`database ${database}`}
              className="group min-w-0"
            >
              <Database className="size-4 shrink-0" />
              <HighlightText
                text={database}
                query={inputValue}
                className={TITLE_CLASS}
              />
              <EnterHint />
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {showTables && listedTables.length > 0 && (
        <CommandGroup heading="Tables">
          {listedTables.map((row) => (
            <CommandItem
              key={`table-${row.database}-${row.name}`}
              onSelect={() => onSelectTable(row)}
              value={`table ${row.database}.${row.name} ${row.engine}`}
              className="group min-w-0"
            >
              <Table className="size-4 shrink-0" />
              <HighlightText
                text={`${row.database}.${row.name}`}
                query={inputValue}
                className={TITLE_CLASS}
              />
              <span className={META_CLASS}>{row.engine}</span>
              <EnterHint />
            </CommandItem>
          ))}
        </CommandGroup>
      )}

      {showActions && <CommandSeparator />}
      {showActions && (
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
      )}
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
