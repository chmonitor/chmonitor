'use client'

import {
  CornerDownLeft,
  Database,
  GlobeIcon,
  History,
  Moon,
  Search,
  SearchX,
  Settings,
  Sparkles,
  Sun,
  Table,
  TextSearch,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import type { RecentPaletteItemKind } from '@/lib/command-palette/recent-items'

import { detectQuickNav, parseTableName } from './command-palette-utils'
import { useTheme } from 'next-themes'
import * as React from 'react'
import { useEffect, useState } from 'react'
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
import {
  addRecentItem,
  getRecentItems,
} from '@/lib/command-palette/recent-items'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { useActiveHostEngine } from '@/lib/hooks/use-active-pg-connection'
import { getVisibleMenuItems } from '@/lib/menu/visible-items'
import { usePathname, useRouter, useSearchParams } from '@/lib/next-compat'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'
import { buildUrl } from '@/lib/url/url-builder'
import { cn, getHost } from '@/lib/utils'

// Cap how many databases/tables are rendered — cmdk fuzzy-filters the
// remaining rows as the user types, but that's about UX (not fetch cost);
// the API call itself is already limited server-side.
const EXPLORER_RESULTS_LIMIT = 200
const EXPLORER_GROUP_MAX = 8

interface ExplorerTableRow {
  database: string
  name: string
  engine: string
}

async function fetchTables(hostId: number): Promise<ExplorerTableRow[]> {
  const res = await apiFetch(
    `/api/v1/tables?hostId=${hostId}&limit=${EXPLORER_RESULTS_LIMIT}`
  )
  if (!res.ok) throw new Error(`Failed to fetch tables: ${res.status}`)
  const json = (await res.json()) as { data: ExplorerTableRow[] }
  return json.data || []
}

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
  const pathname = usePathname()
  const [internalOpen, setInternalOpen] = React.useState(false)
  const [inputValue, setInputValue] = useState('')
  const [recentItems, setRecentItems] = useState<
    ReturnType<typeof getRecentItems>
  >([])
  const [mounted, setMounted] = useState(false)
  const { config } = useFeaturePermissions()
  const engine = useActiveHostEngine()
  const menuItems = getVisibleMenuItems(config, engine)
  const { setTheme, resolvedTheme } = useTheme()
  const { hosts } = useMergedHosts()

  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  useEffect(() => {
    setMounted(true)
  }, [])

  // Recent items can be added from any palette instance (or a prior session),
  // so re-read them each time the palette opens rather than only on mount.
  useEffect(() => {
    if (open) setRecentItems(getRecentItems())
  }, [open])

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
  const hostIdNum = Number(hostId)

  // Databases/tables are lazy-loaded: the query only runs once the palette is
  // actually open, so browsing the dashboard never pays for this fetch.
  const { data: tableRows } = useQuery({
    queryKey: ['/api/v1/tables', 'command-palette', hostIdNum],
    queryFn: () => fetchTables(hostIdNum),
    enabled: open && Number.isFinite(hostIdNum),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const databases = React.useMemo(() => {
    const seen = new Set<string>()
    for (const row of tableRows ?? []) seen.add(row.database)
    return [...seen].slice(0, EXPLORER_GROUP_MAX)
  }, [tableRows])

  const tables = React.useMemo(
    () => (tableRows ?? []).slice(0, EXPLORER_GROUP_MAX),
    [tableRows]
  )

  const rememberSelection = (
    id: string,
    title: string,
    href: string,
    kind: RecentPaletteItemKind,
    description?: string
  ) => {
    addRecentItem({ id, title, href, kind, description })
  }

  const navigate = (
    href: string,
    recent?: { id: string; title: string; description?: string }
  ) => {
    setOpen(false)
    setInputValue('')
    if (recent) {
      rememberSelection(
        recent.id,
        recent.title,
        href,
        'page',
        recent.description
      )
    }
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

  const openExplorerFor = (database: string, table?: string) => {
    setOpen(false)
    setInputValue('')
    const url = buildUrl('/explorer', { host: hostId, database, table })
    if (table) {
      rememberSelection(
        `table-${hostId}-${database}-${table}`,
        `${database}.${table}`,
        url,
        'table'
      )
    } else {
      rememberSelection(`db-${hostId}-${database}`, database, url, 'database')
    }
    router.push(url)
  }

  const handleOpenSettings = () => {
    setOpen(false)
    onOpenSettings?.()
  }

  const handleToggleTheme = () => {
    setOpen(false)
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  const handleSwitchHost = (id: number) => {
    setOpen(false)
    setInputValue('')
    const url = buildUrl(pathname || '/overview', { host: id }, searchParams)
    router.push(url)
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

  const otherHosts = hosts.filter((h) => h.id !== hostIdNum)

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

          {/* Recent items only make sense as a starting point — once the user
              is actively searching, cmdk's own filter takes over. */}
          {inputValue.length === 0 && recentItems.length > 0 && (
            <>
              <CommandGroup heading="Recent">
                {recentItems.map((recent) => (
                  <CommandItem
                    key={recent.id}
                    onSelect={() => {
                      setOpen(false)
                      setInputValue('')
                      rememberSelection(
                        recent.id,
                        recent.title,
                        recent.href,
                        recent.kind,
                        recent.description
                      )
                      router.push(recent.href)
                    }}
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
                  onSelect={() =>
                    navigate(group.href, {
                      id: `page-${group.href}`,
                      title: group.title,
                      description: group.description,
                    })
                  }
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
                  onSelect={() =>
                    navigate(item.href, {
                      id: `page-${item.href}`,
                      title: item.title,
                      description: item.description,
                    })
                  }
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
                  onSelect={() => openExplorerFor(database)}
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
                  onSelect={() => openExplorerFor(row.database, row.name)}
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
              onSelect={() =>
                navigate('/agents', {
                  id: 'action-open-ai-chat',
                  title: 'Open AI Agent chat',
                })
              }
              value="Open AI Agent chat assistant"
              className="group"
            >
              <Sparkles className="size-4 shrink-0" />
              <span>Open AI Agent chat</span>
              <EnterHint />
            </CommandItem>

            {mounted && (
              <CommandItem
                onSelect={handleToggleTheme}
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
                onSelect={() => handleSwitchHost(host.id)}
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
                onSelect={handleOpenSettings}
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
