/**
 * Overview KPI cards must show full titles/values at laptop widths.
 * `truncate` is phone-only (`max-sm:`); sm+ wraps instead of ellipsizing.
 */

import { Activity } from 'lucide-react'

import type { ReactElement } from 'react'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
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

describe('KpiCard overflow', () => {
  test('label and value wrap at sm+ and only truncate on phones', async () => {
    const { KpiCard } = await import('./kpi-card')
    const { container, cleanup } = await renderInto(
      <KpiCard
        icon={Activity}
        label="Active Queries"
        value="12d 1h"
        unit="running"
        sub="1,234 queries today"
      />
    )

    const label = container.querySelector('span.uppercase')
    expect(label?.textContent).toBe('Active Queries')
    expect(label?.className).toContain('max-sm:truncate')
    expect(label?.className).toContain('sm:whitespace-normal')
    expect(label?.className.split(/\s+/)).not.toContain('truncate')

    const value = container.querySelector('.font-mono, .tabular-nums')
    expect(value?.className).toContain('max-sm:truncate')
    expect(value?.className).toContain('sm:whitespace-normal')
    expect(value?.className.split(/\s+/)).not.toContain('truncate')

    await cleanup()
  })
})
