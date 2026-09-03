/**
 * Insight card detail dialog closes from its own X (#3362). The dialog is
 * portaled, but React bubbles the click back to the card's onClick, which
 * re-opened it. happy-dom + react-dom/client.
 */

import type { ReactElement, ReactNode } from 'react'
import type { InsightCard as InsightCardData } from '@/lib/insights/types'

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

mock.module('@/components/ui/app-link', () => ({
  AppLink: ({
    href,
    children,
    ...props
  }: {
    href: string
    children?: ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

mock.module('@/components/charts/chart-registry', () => ({
  getChartComponent: () => undefined,
}))

mock.module('@/components/layout/query-page/dynamic-chart', () => ({
  DynamicChart: () => null,
}))

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

const insight: InsightCardData = {
  key: '0:performance:slow_queries:Slow queries climbing',
  severity: 'warning',
  category: 'performance',
  title: 'Slow queries climbing',
  detail: 'p95 latency doubled over the last hour.',
  metric: 'slow_queries',
  action: { label: 'Open queries', href: '/running-queries' },
  generatedAt: new Date().toISOString(),
}

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

async function click(el: Element) {
  const { act } = await import('react')
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function dialogOpen(): boolean {
  return document.querySelector('[data-slot="dialog-content"]') !== null
}

async function openCard() {
  const { InsightCard } = await import('./insight-card')
  const rendered = await renderInto(
    <InsightCard insight={insight} hostId={0} onDismiss={() => {}} />
  )
  const card = document.querySelector('[aria-label^="View insight:"]')
  if (!card) throw new Error('card not rendered')
  await click(card)
  expect(dialogOpen()).toBe(true)
  return rendered
}

describe('InsightCard detail dialog (#3362)', () => {
  test('X closes the dialog', async () => {
    const rendered = await openCard()
    const close = document.querySelector(
      '[data-slot="dialog-content"] [data-slot="dialog-close"]'
    )
    if (!close) throw new Error('close button not rendered')

    await click(close)

    expect(dialogOpen()).toBe(false)
    await rendered.cleanup()
  })

  test('clicking inside the dialog body keeps it open once, not toggled', async () => {
    const rendered = await openCard()
    const title = document.querySelector('[data-slot="dialog-content"] h2')
    if (!title) throw new Error('title not rendered')

    await click(title)

    expect(
      document.querySelector('[data-slot="dialog-content"]')
    ).not.toBeNull()
    await rendered.cleanup()
  })
})
