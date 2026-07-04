/**
 * Headless render coverage for the Recent Queries expanded-row panel.
 *
 * Most of `RecentQueryExpandedDetails` mirrors the already-shipped
 * `RunningQueryExpandedDetails`, but the failed-row exception block
 * (`{failed && exception && <pre>…}`) is net-new UI. This test mounts the
 * panel for a successful row and a failed row and asserts it renders without
 * throwing, shows the full query text, and surfaces the exception message
 * (and only for failed rows).
 *
 * Uses `happy-dom` + `react-dom/client` + `act` — the same one-off DOM
 * harness `time-range-context.test.tsx` uses, since this repo's components are
 * otherwise covered by Cypress.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

async function renderPanel(row: Record<string, unknown>): Promise<{
  text: string
  html: string
  cleanup: () => void
}> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { RecentQueryExpandedDetails } = await import(
    '../recent-query-expanded-details'
  )

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(<RecentQueryExpandedDetails row={row} />)
  })

  return {
    text: container.textContent ?? '',
    html: container.innerHTML,
    cleanup: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe('RecentQueryExpandedDetails', () => {
  test('successful row shows the full query and no exception block', async () => {
    const { text, cleanup } = await renderPanel({
      query_id: 'abc-123',
      query: 'SELECT count() FROM system.numbers WHERE number > 42',
      query_kind: 'Select',
      database: 'default',
      user: 'reader',
      event_time: '2026-07-04 10:00:00',
      query_duration: 1.5,
      readable_read_rows: '1.00 million',
      readable_read_bytes: '8.00 MiB',
      readable_result_rows: '1.00',
      readable_memory_usage: '12.00 MiB',
      client_name: 'clickhouse-client',
      exception_code: 0,
      exception: '',
    })

    try {
      // Full (untruncated) query text is present in the panel.
      expect(text).toContain(
        'SELECT count() FROM system.numbers WHERE number > 42'
      )
      // Identity / metric fields render.
      expect(text).toContain('abc-123')
      expect(text).toContain('reader')
      // No exception heading for a successful row.
      expect(text).not.toContain('Exception')
    } finally {
      cleanup()
    }
  })

  test('failed row surfaces the exception message and exit code', async () => {
    const { text, cleanup } = await renderPanel({
      query_id: 'def-456',
      query: 'SELECT * FROM missing_table',
      query_kind: 'Select',
      database: 'default',
      user: 'reader',
      event_time: '2026-07-04 10:05:00',
      query_duration: 0.02,
      readable_read_rows: '0.00',
      readable_read_bytes: '0.00 B',
      readable_result_rows: '0.00',
      readable_memory_usage: '0.00 B',
      client_name: 'clickhouse-client',
      exception_code: 60,
      exception:
        'Code: 60. DB::Exception: Table default.missing_table does not exist.',
    })

    try {
      expect(text).toContain('Exception')
      expect(text).toContain('Table default.missing_table does not exist.')
      expect(text).toContain('exit code 60')
    } finally {
      cleanup()
    }
  })
})
