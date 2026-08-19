/**
 * Schema Compare one-host empty state + faded TableList/DdlPair example.
 * happy-dom + react-dom/client — same harness as nav-settings-button.test.tsx.
 */

import type { ReactElement } from 'react'
import type { SchemaDiffResponse } from '@/lib/schema-diff/types'

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
import { assembleCatalog } from '@/lib/schema-diff/catalog'
import { compareCatalogs } from '@/lib/schema-diff/compare'
import { buildExampleSchemaDiff } from '@/lib/schema-diff/example'
import { buildChangePlan } from '@/lib/schema-diff/plan'

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

function twoHostPayload(): SchemaDiffResponse {
  const source = assembleCatalog(
    [
      {
        database: 'app',
        table: 'events',
        engine: 'MergeTree',
        sorting_key: 'id',
        partition_key: '',
        primary_key: 'id',
        create_table_query:
          'CREATE TABLE app.events (id UInt64) ENGINE = MergeTree ORDER BY id',
      },
    ],
    [
      {
        database: 'app',
        table: 'events',
        name: 'id',
        type: 'UInt64',
        codec: '',
      },
    ]
  )
  const target = assembleCatalog(
    [
      {
        database: 'app',
        table: 'events',
        engine: 'MergeTree',
        sorting_key: 'id',
        partition_key: '',
        primary_key: 'id',
        create_table_query:
          'CREATE TABLE app.events (id UInt32) ENGINE = MergeTree ORDER BY id',
      },
    ],
    [
      {
        database: 'app',
        table: 'events',
        name: 'id',
        type: 'UInt32',
        codec: '',
      },
    ]
  )
  const diff = compareCatalogs(source, target)
  return {
    success: true,
    hosts: [
      { id: 0, name: 'staging' },
      { id: 1, name: 'production' },
    ],
    nodes: [],
    scope: 'hosts',
    sourceHostId: 0,
    targetHostId: 1,
    diff,
    plan: buildChangePlan(diff),
  }
}

function matchingHostPayload(): SchemaDiffResponse {
  const catalog = assembleCatalog(
    [
      {
        database: 'app',
        table: 'events',
        engine: 'MergeTree',
        sorting_key: 'id',
        partition_key: '',
        primary_key: 'id',
        create_table_query:
          'CREATE TABLE app.events (id UInt64) ENGINE = MergeTree ORDER BY id',
      },
    ],
    [
      {
        database: 'app',
        table: 'events',
        name: 'id',
        type: 'UInt64',
        codec: '',
      },
    ]
  )
  const diff = compareCatalogs(catalog, catalog)
  return {
    success: true,
    hosts: [
      { id: 0, name: 'clickhouse-0' },
      { id: 1, name: 'clickhouse-1' },
    ],
    nodes: [],
    scope: 'hosts',
    sourceHostId: 0,
    targetHostId: 1,
    diff,
    plan: buildChangePlan(diff),
  }
}

async function setInputValue(input: HTMLInputElement, value: string) {
  const { act } = await import('react')
  await act(async () => {
    const proto = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )
    proto?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Schema Compare one-host empty state', () => {
  test('shows empty copy, Add host, and a faded TableList + DdlPair example', async () => {
    const { ExamplePreviewChrome } = await import(
      '@/components/compare/example-preview-chrome'
    )
    const { EmptyState } = await import('@/components/ui/empty-state')
    const { TableList } = await import('./table-list')
    const { DdlPair } = await import('./ddl-pair')
    const example = buildExampleSchemaDiff()
    const rows = [
      ...example.diff.onlySource,
      ...example.diff.onlyTarget,
      ...example.diff.changed,
    ]

    let addOpen = false
    const { cleanup } = await renderInto(
      <div>
        <EmptyState
          variant="no-data"
          title="Need two saved connections"
          description="Schema Compare diffs staging vs prod. Add another host, or compare replica nodes when this cluster has two or more."
          action={{
            label: 'Add host',
            onClick: () => {
              addOpen = true
            },
            icon: (
              <span data-testid="add-host" className="contents">
                +
              </span>
            ),
          }}
        />
        <ExamplePreviewChrome>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <TableList
              rows={rows}
              selectedKey={rows[0]?.key ?? null}
              onSelect={() => {}}
              example
            />
            {rows[0] ? <DdlPair selected={rows[0]} /> : null}
          </div>
        </ExamplePreviewChrome>
      </div>
    )

    try {
      expect(document.body.textContent).toContain('Need two saved connections')
      expect(document.body.textContent).toContain('staging vs prod')
      expect(document.body.textContent).toContain('Example')
      expect(document.body.textContent).toContain('analytics.events')
      expect(document.body.textContent).toContain('Source DDL')
      const faded = document.querySelector(
        '[data-testid="compare-example-preview"]'
      )
      expect(faded).not.toBeNull()
      expect(faded?.className).toContain('pointer-events-none')
      expect(faded?.className).toContain('opacity-40')
      expect(document.querySelector('[data-testid="add-host"]')).not.toBeNull()

      const { act } = await import('react')
      const add = document
        .querySelector('[data-testid="add-host"]')
        ?.closest('button') as HTMLButtonElement
      await act(async () => {
        add.click()
      })
      expect(addOpen).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test('AddHostButton opens AddHostDialog', async () => {
    const { AddHostDialog } = await import('@/components/connections')
    const { Button } = await import('@/components/ui/button')
    const { useState } = await import('react')

    function Harness() {
      const [addOpen, setAddOpen] = useState(false)
      return (
        <>
          <Button data-testid="add-host" onClick={() => setAddOpen(true)}>
            Add host
          </Button>
          <AddHostDialog open={addOpen} onOpenChange={setAddOpen} />
        </>
      )
    }

    const { cleanup } = await renderInto(<Harness />)
    try {
      expect(document.body.textContent).not.toContain('Connections')
      const { act } = await import('react')
      const button = document.querySelector(
        '[data-testid="add-host"]'
      ) as HTMLButtonElement
      await act(async () => {
        button.click()
      })
      expect(
        document.querySelector('[data-testid="add-host-dialog"]')
      ).not.toBeNull()
      expect(document.body.textContent).toContain('Add host dialog')
      expect(document.body.textContent).not.toContain('Add Connection')
    } finally {
      await cleanup()
    }
  })
})

describe('Schema Compare two-host path', () => {
  test('renders live pair names and table diffs without the example badge', async () => {
    const { SchemaDiffView } = await import('./schema-diff-view')
    const data = twoHostPayload()

    const { cleanup } = await renderInto(
      <SchemaDiffView
        data={data}
        sourceId={0}
        targetId={1}
        scope="hosts"
        peers={data.hosts}
        hostCount={2}
        nodeCount={0}
        onPairChange={() => {}}
      />
    )

    try {
      expect(document.body.textContent).toContain('staging')
      expect(document.body.textContent).toContain('production')
      expect(document.body.textContent).toContain('app.events')
      expect(document.body.textContent).not.toContain('Host A')
      expect(document.body.textContent).not.toMatch(
        /Comparing .+ tables differ/
      )
      const source = document.querySelector(
        '[data-testid="compare-source"]'
      ) as HTMLElement
      const target = document.querySelector(
        '[data-testid="compare-target"]'
      ) as HTMLElement
      expect(source?.textContent).toContain('staging')
      expect(target?.textContent).toContain('production')
      expect(source?.textContent).not.toMatch(/^0/)
      expect(target?.textContent).not.toMatch(/^1/)
      const copy = document.querySelector(
        '[aria-label="Copy recommended SQL"]'
      ) as HTMLButtonElement
      expect(copy).not.toBeNull()
      expect(copy.disabled).toBe(true)
      expect(copy.textContent).toContain('Copy recommended SQL')
      const exampleBadges = [...document.querySelectorAll('span')].filter(
        (el) => el.textContent === 'Example'
      )
      expect(exampleBadges).toHaveLength(0)
    } finally {
      await cleanup()
    }
  })

  test('Select closed value shows peer names, not numeric ids', async () => {
    const { SchemaDiffView } = await import('./schema-diff-view')
    const data = twoHostPayload()

    const { cleanup } = await renderInto(
      <SchemaDiffView
        data={data}
        sourceId={0}
        targetId={1}
        scope="hosts"
        peers={data.hosts}
        hostCount={2}
        nodeCount={0}
        onPairChange={() => {}}
      />
    )

    try {
      const sourceValue = document.querySelector(
        '[data-testid="compare-source"] [data-slot="select-value"]'
      )
      const targetValue = document.querySelector(
        '[data-testid="compare-target"] [data-slot="select-value"]'
      )
      expect(sourceValue?.textContent).toBe('staging')
      expect(targetValue?.textContent).toBe('production')
      expect(sourceValue?.textContent).not.toBe('0')
      expect(targetValue?.textContent).not.toBe('1')
    } finally {
      await cleanup()
    }
  })

  test('matching schemas with Differences only says Schemas match', async () => {
    const { SchemaDiffView } = await import('./schema-diff-view')
    const data = matchingHostPayload()

    const { cleanup } = await renderInto(
      <SchemaDiffView
        data={data}
        sourceId={0}
        targetId={1}
        scope="hosts"
        peers={data.hosts}
        hostCount={2}
        nodeCount={0}
        onPairChange={() => {}}
      />
    )

    try {
      expect(document.body.textContent).toContain('Schemas match')
      expect(document.body.textContent).toContain(
        'Switch to All to list every table.'
      )
      expect(document.body.textContent).not.toContain('No tables match')
      expect(document.body.textContent).not.toMatch(
        /Comparing .+ tables differ/
      )
    } finally {
      await cleanup()
    }
  })

  test('name filter miss still says No tables match', async () => {
    const { SchemaDiffView } = await import('./schema-diff-view')
    const data = twoHostPayload()

    const { cleanup } = await renderInto(
      <SchemaDiffView
        data={data}
        sourceId={0}
        targetId={1}
        scope="hosts"
        peers={data.hosts}
        hostCount={2}
        nodeCount={0}
        onPairChange={() => {}}
      />
    )

    try {
      const input = document.querySelector(
        'input[placeholder="Filter tables…"]'
      ) as HTMLInputElement
      expect(input).not.toBeNull()
      await setInputValue(input, 'no-such-table')
      expect(document.body.textContent).toContain('No tables match')
      expect(document.body.textContent).not.toContain('Schemas match')
    } finally {
      await cleanup()
    }
  })

  test('scope toggle changes scope from hosts to replica nodes', async () => {
    const { SchemaDiffView } = await import('./schema-diff-view')
    const data = twoHostPayload()
    const seen: string[] = []

    const { cleanup } = await renderInto(
      <SchemaDiffView
        data={{
          ...data,
          nodes: [
            { id: 10, name: 'clickhouse-0' },
            { id: 11, name: 'clickhouse-1' },
          ],
        }}
        sourceId={0}
        targetId={1}
        scope="hosts"
        peers={data.hosts}
        hostCount={2}
        nodeCount={2}
        onPairChange={() => {}}
        onScopeChange={(next) => {
          seen.push(next)
        }}
      />
    )

    try {
      const group = document.querySelector(
        '[aria-label="Compare saved connections or replica nodes"]'
      )
      expect(group).not.toBeNull()
      const replica = [...document.querySelectorAll('button')].find(
        (el) => el.textContent === 'Replica nodes'
      ) as HTMLButtonElement
      expect(replica).not.toBeNull()
      const { act } = await import('react')
      await act(async () => {
        replica.click()
      })
      expect(seen).toEqual(['nodes'])
    } finally {
      await cleanup()
    }
  })
})
