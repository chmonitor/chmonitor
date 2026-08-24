/**
 * Settings Diff one-host vs-default + pair filter with user-connection ids.
 */

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
import { filterSettingsDiffRows } from '@/lib/settings-diff/filter'
import { mergeSettingsDiff } from '@/lib/settings-diff/merge'

mock.module('@/components/connections', () => ({
  AddHostDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-host-dialog">Add host dialog</div> : null,
}))

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

async function renderInto(
  node: ReactElement
): Promise<{ container: HTMLDivElement; cleanup: () => Promise<void> }> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const {
    RouterContextProvider,
    createMemoryHistory,
    createRootRoute,
    createRouter,
  } = await import('@tanstack/react-router')
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <RouterContextProvider router={router}>{node}</RouterContextProvider>
    )
  })

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      container.remove()
    },
  }
}

function tableToolbar() {
  const table = document.querySelector('[data-testid="settings-diff-table"]')
  return {
    table,
    search: table?.querySelector(
      'input[placeholder="Search across all fields..."]'
    ),
    filters: Array.from(table?.querySelectorAll('button') ?? []).find((btn) =>
      btn.textContent?.includes('Filters')
    ),
    display: Array.from(table?.querySelectorAll('button') ?? []).find((btn) =>
      btn.textContent?.includes('Display options')
    ),
  }
}

describe('Settings Diff one-host vs default', () => {
  test('renders the live defaults table and add-host banner, not an example preview', async () => {
    const { SettingsDiffTable } = await import('./settings-diff-table')
    const { Alert, AlertDescription, AlertTitle } = await import(
      '@/components/ui/alert'
    )
    const { AddHostButton } = await import(
      '@/components/compare/add-host-button'
    )

    const rows = mergeSettingsDiff([
      {
        peerId: 0,
        table: 'settings',
        rows: [
          {
            name: 'max_threads',
            value: '8',
            changed: 1,
            description: '',
            defaultValue: '0',
          },
        ],
      },
    ])

    const { cleanup } = await renderInto(
      <div>
        <Alert>
          <AlertTitle>Comparing against defaults</AlertTitle>
          <AlertDescription>
            This host is compared to setting defaults. Add host to diff another
            node.
            <AddHostButton variant="outline" />
          </AlertDescription>
        </Alert>
        <SettingsDiffTable
          columns={[{ id: 0, name: 'prod' }]}
          rows={filterSettingsDiffRows(rows, {
            showDiffsOnly: false,
            showChangedOnly: false,
            nameFilter: '',
          })}
          toolbarExtras={<button type="button">Changed from default</button>}
        />
      </div>
    )

    try {
      expect(document.body.textContent).toContain('Comparing against defaults')
      expect(document.body.textContent).toContain('max_threads')
      expect(document.body.textContent).toContain('default')
      expect(document.body.textContent).toContain('prod')
      expect(document.body.textContent).not.toContain('Host A')
      expect(
        document.querySelector('[data-testid="settings-diff-table"]')
      ).not.toBeNull()
      expect(document.querySelector('[data-testid="add-host"]')).not.toBeNull()
      expect(
        document.querySelector('[data-testid="add-host"]')?.className
      ).toContain('min-h-11')
      const { table, search, filters, display } = tableToolbar()
      expect(search).not.toBeNull()
      expect(filters).toBeDefined()
      expect(display).toBeDefined()
      expect(table?.querySelector('h1')).toBeNull()
      expect(table?.className).toContain('rounded-xl')
      expect(table?.textContent).toContain('Changed from default')
    } finally {
      await cleanup()
    }
  })
})

describe('Settings Diff matching rows', () => {
  test('lists matching settings with a green check instead of an empty All matched card', async () => {
    const { SettingsDiffTable } = await import('./settings-diff-table')
    const rows = mergeSettingsDiff([
      {
        peerId: 0,
        table: 'settings',
        rows: [
          {
            name: 'max_threads',
            value: '8',
            changed: 0,
            description: '',
            defaultValue: '8',
          },
          {
            name: 'max_memory_usage',
            value: '0',
            changed: 1,
            description: '',
            defaultValue: '0',
          },
        ],
      },
      {
        peerId: 1,
        table: 'settings',
        rows: [
          {
            name: 'max_threads',
            value: '8',
            changed: 0,
            description: '',
            defaultValue: '8',
          },
          {
            name: 'max_memory_usage',
            value: '10G',
            changed: 1,
            description: '',
            defaultValue: '0',
          },
        ],
      },
    ])

    const { cleanup } = await renderInto(
      <SettingsDiffTable
        columns={[
          { id: 0, name: 'clickhouse-0' },
          { id: 1, name: 'clickhouse-1' },
        ]}
        rows={filterSettingsDiffRows(rows, {
          showDiffsOnly: false,
          showChangedOnly: false,
          nameFilter: '',
        })}
      />
    )

    try {
      expect(document.body.textContent).toContain('max_memory_usage')
      expect(document.body.textContent).toContain('max_threads')
      const grid = document.querySelector(
        '[data-testid="settings-diff-table"] table'
      )
      expect(grid?.querySelectorAll('[aria-label="yes"]').length).toBe(1)
      expect(grid?.querySelectorAll('[aria-label="no"]').length).toBe(1)
      expect(document.body.textContent).not.toContain('All matched')
    } finally {
      await cleanup()
    }
  })

  test('diffs-only with no deltas still lists every setting with a check', async () => {
    const { SettingsDiffTable } = await import('./settings-diff-table')
    const rows = mergeSettingsDiff([
      {
        peerId: 0,
        table: 'settings',
        rows: [
          {
            name: 'max_threads',
            value: '8',
            changed: 0,
            description: '',
            defaultValue: '8',
          },
        ],
      },
      {
        peerId: 1,
        table: 'settings',
        rows: [
          {
            name: 'max_threads',
            value: '8',
            changed: 0,
            description: '',
            defaultValue: '8',
          },
        ],
      },
    ])

    const { cleanup } = await renderInto(
      <SettingsDiffTable
        columns={[
          { id: 0, name: 'clickhouse-0' },
          { id: 1, name: 'clickhouse-1' },
        ]}
        rows={filterSettingsDiffRows(rows, {
          showDiffsOnly: true,
          showChangedOnly: false,
          nameFilter: '',
        })}
      />
    )

    try {
      expect(document.body.textContent).toContain('max_threads')
      const grid = document.querySelector(
        '[data-testid="settings-diff-table"] table'
      )
      expect(grid?.querySelectorAll('[aria-label="yes"]').length).toBe(1)
      expect(document.body.textContent).not.toContain('All matched')
      expect(document.body.textContent).not.toContain('No settings found')
      expect(document.body.textContent).not.toContain('Show matching settings')
    } finally {
      await cleanup()
    }
  })

  test('a name-filter miss still says No settings match', async () => {
    const { SettingsDiffTable } = await import('./settings-diff-table')

    const { cleanup } = await renderInto(
      <SettingsDiffTable columns={[{ id: 0, name: 'prod' }]} rows={[]} />
    )

    try {
      const { table, search } = tableToolbar()
      expect(table).not.toBeNull()
      expect(search).not.toBeNull()
      expect(document.body.textContent).toMatch(/No settings (match|found)/i)
      expect(document.body.textContent).not.toContain('All matched')
    } finally {
      await cleanup()
    }
  })
})

describe('Settings Diff pair ids include user connections', () => {
  test('resolvePair accepts negative database and browser ids', async () => {
    const { resolvePair } = await import('@/lib/compare/scope')
    const hosts = [
      { id: -1000, name: 'staging-db' },
      { id: -1, name: 'prod-browser' },
    ]
    expect(resolvePair(hosts, -1000, -1)).toEqual({
      sourceId: -1000,
      targetId: -1,
    })
  })
})
