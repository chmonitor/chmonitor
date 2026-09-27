/**
 * ⌘K indexing vs the rail (#3463). Two different hide mechanisms, two
 * different answers:
 *
 * - a page the USER hid stays indexed, with a Hidden hint, because ⌘K plus the
 *   *Keep in sidebar* chip is how they get it back;
 * - a page the HOST cannot run is dropped, because landing on it only produces
 *   "System table not found on this host" and there is nothing to restore.
 *
 * happy-dom + react-dom/client. The availability map is driven through the
 * shared TanStack Query cache, so the real hook is what runs.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ReactElement } from 'react'
import type { MenuItem as MenuItemType } from '@/components/menu/types'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import * as realActivePg from '@/lib/hooks/use-active-pg-connection'
import * as realSwr from '@/lib/swr'

// `mock.module` is process-global in bun, so each stub SPREADS the real module
// — a narrow replacement strips every other export for every later test file.
mock.module('@/lib/swr', () => ({ ...realSwr, useHostId: () => 0 }))

// The engine gate needs a live router plus the per-user PG connection list,
// neither of which is what this file is about.
mock.module('@/lib/hooks/use-active-pg-connection', () => ({
  ...realActivePg,
  useActiveHostEngine: () => 'clickhouse',
}))

const AVAILABILITY_KEY = ['/api/v1/table-availability', 0]

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false
      },
    })) as typeof window.matchMedia
  }
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.replaceChildren()
})

/** The host reports EVERY tableCheck table in the catalog as missing. */
async function everyTableCheckMissing(): Promise<Record<string, boolean>> {
  const { menuItemsConfig } = await import('@/menu')
  const tables = new Set<string>()
  const walk = (items: typeof menuItemsConfig) => {
    for (const item of items) {
      for (const table of [item.tableCheck ?? []].flat()) tables.add(table)
      if (item.items) walk(item.items)
    }
  }
  walk(menuItemsConfig)
  return Object.fromEntries([...tables].map((table) => [table, false]))
}

async function mount({
  dimUnavailablePages = false,
  missingTables = {},
}: {
  dimUnavailablePages?: boolean
  missingTables?: Record<string, boolean>
} = {}) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { usePaletteMenuItems } = await import(
    '@/lib/menu/use-visible-menu-items'
  )
  const { USER_SETTINGS_QUERY_KEY } = await import(
    '@/lib/hooks/use-user-settings'
  )
  const { DEFAULT_USER_SETTINGS } = await import('@/lib/types/user-settings')

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, {
    ...DEFAULT_USER_SETTINGS,
    dimUnavailablePages,
  })
  queryClient.setQueryDefaults(AVAILABILITY_KEY, {
    queryFn: async () => ({
      success: true,
      data: { available: missingTables },
    }),
  })
  queryClient.setQueryData(AVAILABILITY_KEY, {
    success: true,
    data: { available: missingTables },
  })

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let catalog: MenuItemType[] = []

  function Probe() {
    catalog = usePaletteMenuItems()
    return null
  }

  // No FeaturePermissionsProvider: the default config has no `metadataDb`
  // block, which is fail-open, so every metadata-DB-gated page reads as
  // available. These cases are all about `tableCheck`.
  const tree = (): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  )

  const render = async () => {
    await act(async () => {
      root.render(tree())
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const cleanup = async () => {
    await act(async () => {
      root.unmount()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    container.remove()
  }

  return {
    render,
    cleanup,
    catalog: () => catalog,
    hrefs: () =>
      catalog.flatMap((item) =>
        item.items?.length
          ? (item.items ?? []).map((child) => child.href)
          : [item.href]
      ),
  }
}

describe('usePaletteMenuItems availability filtering (#3463)', () => {
  test('indexes a tableCheck page while its table is readable', async () => {
    const m = await mount()
    try {
      await m.render()
      expect(m.hrefs()).toContain('/traffic')
    } finally {
      await m.cleanup()
    }
  })

  test('drops a tableCheck page the host cannot run', async () => {
    const m = await mount({
      missingTables: { 'system.query_log': false },
    })
    try {
      await m.render()
      expect(m.hrefs()).not.toContain('/traffic')
      // Its siblings stay — only the impossible page goes.
      expect(m.hrefs()).toContain('/insights')
      expect(m.hrefs()).toContain('/insights-settings')
    } finally {
      await m.cleanup()
    }
  })

  test('keeps it indexed when the user asked to Dim', async () => {
    const m = await mount({
      dimUnavailablePages: true,
      missingTables: { 'system.query_log': false },
    })
    try {
      await m.render()
      expect(m.hrefs()).toContain('/traffic')
    } finally {
      await m.cleanup()
    }
  })

  test('drops a fully-gated group rather than indexing an empty heading', async () => {
    const m = await mount({ missingTables: await everyTableCheckMissing() })
    try {
      await m.render()
      // Merges is 5/5 tableCheck-gated, so it has nothing left to show.
      expect(m.hrefs().filter((href) => href.startsWith('/merges'))).toEqual([])
      // The catalog still has ungated pages — only gated ones went.
      expect(m.hrefs().length).toBeGreaterThan(5)
    } finally {
      await m.cleanup()
    }
  })

  test('no returned group is ever left childless', async () => {
    const m = await mount({ missingTables: await everyTableCheckMissing() })
    try {
      await m.render()
      const childless = m
        .catalog()
        .filter((group) => group.items && group.items.length === 0)
        .map((group) => group.title)
      expect(childless).toEqual([])
    } finally {
      await m.cleanup()
    }
  })
})
