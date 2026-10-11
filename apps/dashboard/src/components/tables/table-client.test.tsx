/**
 * #3737 — an optional table whose backing system table is absent comes back
 * from /api/v1/tables/$name as `200 { data: [], metadata: { unavailable: true,
 * unavailableReason, missingTables } }`. The page must say the table is not
 * available on this server (with enable guidance), not "No Data": "No Data"
 * tells the operator to wait for activity that can never arrive.
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

let tableData: {
  data: Record<string, unknown>[]
  metadata: Record<string, unknown> | undefined
} = { data: [], metadata: undefined }

mock.module('@/lib/query/use-table-data', () => ({
  useTableData: () => ({
    data: tableData.data,
    metadata: tableData.metadata,
    error: undefined,
    isPending: false,
    isValidating: false,
    refresh: () => {},
  }),
}))
mock.module('@/lib/swr/use-host', () => ({ useHostId: () => 0 }))
mock.module('@/lib/swr/use-host-status', () => ({
  useHostStatus: () => ({ data: undefined }),
}))
mock.module('@/components/cards/card-toolbar', () => ({
  CardToolbar: () => null,
}))

const { TableClient, unavailableTableError } = await import('./table-client')

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const roots: Array<{ unmount: () => void }> = []

afterEach(async () => {
  const { act } = await import('react')
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  tableData = { data: [], metadata: undefined }
  document.body.replaceChildren()
})

async function renderInto(node: ReactElement): Promise<HTMLDivElement> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(node)
  })
  // Let the lazily loaded guidance markdown resolve inside act().
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
  return container
}

const config = { name: 'backups', sql: 'SELECT 1', columns: [] }

describe('unavailableTableError', () => {
  test('no unavailable flag → undefined (normal empty table)', () => {
    expect(
      unavailableTableError({ queryId: '', duration: 0, rows: 0, host: '0' })
    ).toBeUndefined()
    expect(unavailableTableError(undefined)).toBeUndefined()
  })

  test('table-route shape → table_not_found carrying reason + missing tables', () => {
    const err = unavailableTableError({
      queryId: '',
      duration: 0,
      rows: 0,
      host: '0',
      unavailable: true,
      unavailableReason: 'Table not on this server',
      missingTables: ['system.backup_log'],
    } as never)
    expect(err).toEqual({
      type: 'table_not_found',
      message: 'Table not on this server',
      details: { missingTables: ['system.backup_log'] },
    } as never)
  })

  test('chart-route object shape is understood too', () => {
    const err = unavailableTableError({
      queryId: '',
      duration: 0,
      rows: 0,
      host: '0',
      unavailable: {
        reason: 'table_not_found',
        message: 'gone',
        missingTables: ['system.error_log'],
      },
    })
    expect(err?.message).toBe('gone')
    expect(
      (err as { details?: { missingTables?: string[] } }).details?.missingTables
    ).toEqual(['system.error_log'])
  })
})

describe('TableClient empty states', () => {
  test('unavailable response renders "Table not available", not "No Data"', async () => {
    tableData = {
      data: [],
      metadata: {
        queryId: '',
        duration: 0,
        rows: 0,
        host: '0',
        unavailable: true,
        unavailableReason: 'Requested resource was not found',
        missingTables: ['system.backup_log'],
      },
    }
    const container = await renderInto(
      <TableClient title="Backups" queryConfig={config as never} />
    )
    const text = container.textContent ?? ''
    expect(
      container.querySelector('[aria-label="Backups unavailable"]')
    ).not.toBeNull()
    expect(text).not.toContain('No data available for this query')
  })

  test('a genuinely empty result still renders the "No Data" state', async () => {
    tableData = {
      data: [],
      metadata: { queryId: '', duration: 0, rows: 0, host: '0' },
    }
    const container = await renderInto(
      <TableClient title="Backups" queryConfig={config as never} />
    )
    expect(container.textContent).toContain('No data available for this query')
    expect(container.querySelector('[aria-label="Backups unavailable"]')).toBe(
      null
    )
  })
})
