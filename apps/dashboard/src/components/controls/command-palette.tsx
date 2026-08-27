'use client'

import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'

import {
  CommandPaletteFooter,
  CommandPaletteResults,
  CommandPaletteTabs,
  CommandPaletteTrigger,
} from './command-palette/command-palette-items'
import { useCommandPaletteState } from './command-palette/use-command-palette-state'
import {
  EXPLORER_RESULTS_LIMIT,
  type ExplorerTableRow,
  usePaletteGroups,
} from './command-palette/use-palette-groups'
import { parseTableName } from './command-palette-utils'
import { useTheme } from 'next-themes'
import { CommandDialog, CommandInput } from '@/components/ui/command'
import { useFavoriteHrefs } from '@/hooks/use-favorites'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { getFavoriteMenuItems } from '@/lib/menu/derive-favorites'
import { useMenuWorkspaceCatalog } from '@/lib/menu/use-menu-workspace'
import { usePaletteMenuItems } from '@/lib/menu/use-visible-menu-items'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'
import { buildUrl, splitHref } from '@/lib/url/url-builder'

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

export const CommandPalette = function CommandPalette({
  open: controlledOpen,
  onOpenChange,
  onOpenSettings,
}: CommandPaletteProps = {}) {
  // Named `routerNavigate` (not `navigate`) — this file defines its own
  // `navigate` wrapper below (external-link handling, recent-item tracking).
  const routerNavigate = useNavigate()
  const searchParams = useUrlSearchParams()
  const pathname = useLocation({ select: (l) => l.pathname })
  const {
    open,
    setOpen,
    inputValue,
    setInputValue,
    tab,
    setTab,
    recentItems,
    mounted,
    closeAndReset,
    rememberSelection,
  } = useCommandPaletteState({ open: controlledOpen, onOpenChange })

  const menuItems = usePaletteMenuItems()
  const { hiddenHrefs } = useMenuWorkspaceCatalog()
  const favoriteHrefs = useFavoriteHrefs()
  const favoriteMenuItems = getFavoriteMenuItems(menuItems, favoriteHrefs)
  const { setTheme, resolvedTheme } = useTheme()
  const { hosts } = useMergedHosts()

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

  const { leafItems, sectionedItems, databases, tables, otherHosts, quickNav } =
    usePaletteGroups({
      menuItems,
      favoriteMenuItems,
      tableRows,
      hosts,
      currentHostId: hostIdNum,
      query: inputValue,
    })

  const navigate = (
    href: string,
    recent?: { id: string; title: string; description?: string }
  ) => {
    closeAndReset()
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
    routerNavigate(splitHref(url))
  }

  const handleGoToQuery = () => {
    closeAndReset()
    const url = buildUrl('/query', {
      host: hostId,
      query_id: inputValue.trim(),
    })
    routerNavigate(splitHref(url))
  }

  const handleOpenInExplorer = () => {
    closeAndReset()
    const { database, table } = parseTableName(inputValue)
    const url = buildUrl('/explorer', { host: hostId, database, table })
    routerNavigate(splitHref(url))
  }

  const openExplorerFor = (database: string, table?: string) => {
    closeAndReset()
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
    routerNavigate(splitHref(url))
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
    closeAndReset()
    const url = buildUrl(pathname || '/overview', { host: id }, searchParams)
    routerNavigate(splitHref(url))
  }

  return (
    <>
      <CommandPaletteTrigger onOpen={() => setOpen(true)} />

      <CommandDialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) {
            setInputValue('')
            setTab('all')
          }
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
        <CommandPaletteTabs value={tab} onChange={setTab} />
        <CommandPaletteResults
          inputValue={inputValue}
          tab={tab}
          favoriteMenuItems={favoriteMenuItems}
          onSelectFavorite={(item) =>
            navigate(item.href, {
              id: `page-${item.href}`,
              title: item.title,
              description: item.description,
            })
          }
          recentItems={recentItems}
          onSelectRecent={(recent) => {
            closeAndReset()
            rememberSelection(
              recent.id,
              recent.title,
              recent.href,
              recent.kind,
              recent.description
            )
            routerNavigate(splitHref(recent.href))
          }}
          quickNav={quickNav}
          onGoToQuery={handleGoToQuery}
          onOpenInExplorer={handleOpenInExplorer}
          leafItems={leafItems}
          sectionedItems={sectionedItems}
          hiddenHrefs={hiddenHrefs}
          onSelectMenuItem={(item) =>
            navigate(item.href, {
              id: `page-${item.href}`,
              title: item.title,
              description: item.description,
            })
          }
          databases={databases}
          tables={tables}
          onSelectDatabase={(database) => openExplorerFor(database)}
          onSelectTable={(row) => openExplorerFor(row.database, row.name)}
          mounted={mounted}
          resolvedTheme={resolvedTheme}
          onToggleTheme={handleToggleTheme}
          onOpenAiChat={() =>
            navigate('/agents', {
              id: 'action-open-ai-chat',
              title: 'Open AI Agent chat',
            })
          }
          otherHosts={otherHosts}
          onSwitchHost={handleSwitchHost}
          onOpenSettings={onOpenSettings ? handleOpenSettings : undefined}
        />

        <CommandPaletteFooter />
      </CommandDialog>
    </>
  )
}
