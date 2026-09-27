/**
 * *Keep in sidebar* is a USER affordance (#3463). It must appear only for a
 * page on the user's own hide list — never for a page the host simply cannot
 * run, because the user did not hide it and clicking it would restore nothing.
 *
 * No module mocks: the hide list is seeded straight into the settings query so
 * the chip reads the real `useMenuWorkspaceCatalog` with a deterministic value.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ReactElement } from 'react'

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
mock.module('@/lib/hooks/use-active-pg-connection', () => ({
  ...realActivePg,
  useActiveHostEngine: () => 'clickhouse',
}))

const STORAGE_KEY = 'clickhouse-monitor-user-settings'
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
  localStorage.removeItem(STORAGE_KEY)
  document.body.replaceChildren()
})

async function mount(pathname: string, hiddenMenuHrefs: string[]) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { KeepInSidebarChip } = await import('./keep-in-sidebar')
  const { USER_SETTINGS_QUERY_KEY } = await import(
    '@/lib/hooks/use-user-settings'
  )
  const { DEFAULT_USER_SETTINGS } = await import('@/lib/types/user-settings')
  const {
    RouterContextProvider,
    createMemoryHistory,
    createRootRoute,
    createRouter,
  } = await import('@tanstack/react-router')

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // The user's own hide list — the ONLY thing that may trigger the chip.
  queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, {
    ...DEFAULT_USER_SETTINGS,
    workspacePreset: 'custom',
    hiddenMenuHrefs,
  })

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [pathname] }),
  })

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  const tree = (): ReactElement => (
    <RouterContextProvider router={router}>
      <QueryClientProvider client={queryClient}>
        <KeepInSidebarChip />
      </QueryClientProvider>
    </RouterContextProvider>
  )

  await act(async () => {
    root.render(tree())
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  return {
    chip: () => container.querySelector('[data-testid="keep-in-sidebar"]'),
    cleanup: async () => {
      await act(async () => {
        root.unmount()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      container.remove()
    },
  }
}

describe('KeepInSidebarChip (#3463)', () => {
  test('offers Keep for a page the USER hid', async () => {
    const m = await mount('/merges', ['/merges'])
    try {
      expect(m.chip()).not.toBeNull()
    } finally {
      await m.cleanup()
    }
  })

  test('stays silent on a page the host cannot run (availability-hidden)', async () => {
    // The same situation the rail hides Traffic in: system.query_log missing.
    // The hide list is untouched, so there is nothing to restore and no chip.
    const m = await mount('/traffic', [])
    try {
      expect(m.chip()).toBeNull()
    } finally {
      await m.cleanup()
    }
  })
})
