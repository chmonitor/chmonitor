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
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(node)
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
        />
      </div>
    )

    try {
      expect(document.body.textContent).toContain('Comparing against defaults')
      expect(document.body.textContent).toContain('max_threads')
      expect(document.body.textContent).toContain('Default')
      expect(document.body.textContent).toContain('prod')
      expect(document.body.textContent).not.toContain('Host A')
      const faded = document.querySelector('.opacity-40')
      expect(faded).toBeNull()
      expect(document.querySelector('[data-testid="add-host"]')).not.toBeNull()
      expect(
        document.querySelector('[data-testid="add-host"]')?.className
      ).toContain('min-h-11')
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
      expect(
        document.querySelectorAll('[data-testid="settings-diff-matched-icon"]')
          .length
      ).toBe(1)
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
      expect(
        document.querySelectorAll('[data-testid="settings-diff-matched-icon"]')
          .length
      ).toBe(1)
      expect(document.body.textContent).not.toContain('All matched')
      expect(document.body.textContent).not.toContain('No settings match')
      expect(document.body.textContent).not.toContain('Show matching settings')
    } finally {
      await cleanup()
    }
  })

  test('a name-filter miss still says No settings match', async () => {
    const { SettingsDiffTable } = await import('./settings-diff-table')

    const { cleanup } = await renderInto(
      <SettingsDiffTable
        columns={[{ id: 0, name: 'prod' }]}
        rows={[]}
        nameFilter="no-such"
        onNameFilterChange={() => {}}
      />
    )

    try {
      const table = document.querySelector(
        '[data-testid="settings-diff-table"]'
      )
      expect(
        table?.querySelector('[data-testid="settings-diff-table-filter"]')
      ).not.toBeNull()
      expect(document.body.textContent).toContain('No settings match')
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
