/**
 * Schema Compare one-host example + two-host live layout.
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
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { assembleCatalog } from '@/lib/schema-diff/catalog'
import { compareCatalogs } from '@/lib/schema-diff/compare'
import { buildExampleSchemaDiff } from '@/lib/schema-diff/example'
import { buildChangePlan } from '@/lib/schema-diff/plan'

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

describe('Schema Compare one-host example', () => {
  test('renders example preview and Add another host opens the connection dialog', async () => {
    const { ExamplePreviewChrome } = await import(
      '@/components/compare/example-preview-chrome'
    )
    const { SchemaDiffView } = await import('./schema-diff-view')
    const example = buildExampleSchemaDiff()

    const { cleanup } = await renderInto(
      <ExamplePreviewChrome>
        <SchemaDiffView
          data={example}
          sourceId={0}
          targetId={1}
          scope="hosts"
          peers={example.hosts}
          hostCount={2}
          nodeCount={0}
          onPairChange={() => {}}
          example
        />
      </ExamplePreviewChrome>
    )

    try {
      expect(document.body.textContent).toContain('Example')
      expect(document.body.textContent).toContain('Host A')
      expect(document.body.textContent).toContain('Host B')
      expect(document.body.textContent).toContain('analytics.events')
      expect(
        document.querySelector('[data-testid="add-another-host"]')
      ).not.toBeNull()
      expect(
        document.querySelector('[data-testid="add-another-host"]')?.className
      ).toContain('min-h-11')

      const { act } = await import('react')
      const button = document.querySelector(
        '[data-testid="add-another-host"]'
      ) as HTMLButtonElement
      await act(async () => {
        button.click()
      })

      expect(document.body.textContent).toContain('Connections')
      expect(document.body.textContent).toContain('Add Connection')
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
      const exampleBadges = [...document.querySelectorAll('span')].filter(
        (el) => el.textContent === 'Example'
      )
      expect(exampleBadges).toHaveLength(0)
    } finally {
      await cleanup()
    }
  })
})
