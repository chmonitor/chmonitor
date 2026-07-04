/**
 * Proves the shared dashboard time range actually propagates through React
 * context to a subscribing widget: a range change made via
 * `DashboardTimeRangeProvider`'s `setRange` (as the toolbar's
 * `DateRangeSelector` would call) causes a real consumer component (using
 * `useDashboardTimeRange()`, the same hook `widget-chart.tsx` uses) to
 * re-render with the new `lastHours`/`interval` — not a synthetic
 * re-implementation of the priority logic.
 *
 * Uses `happy-dom` (registered globally, this file only) + `react-dom/client`
 * + `act` because this repo has no existing DOM test harness (components are
 * otherwise covered by Cypress) — this is the one bun:test file in the repo
 * that needs a real DOM to mount React and observe a state-driven re-render.
 */

import type { DateRangeValue } from '@/components/date-range'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

beforeAll(() => {
  GlobalRegistrator.register()
  // Required so React's `act()` runs synchronously instead of warning that
  // the environment isn't configured for it (bun:test has no such flag set
  // by default, unlike Jest/Vitest's DOM presets).
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

describe('DashboardTimeRangeProvider / useDashboardTimeRange', () => {
  test('a range change propagates the new lastHours/interval to a subscribing widget', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { DashboardTimeRangeProvider, useDashboardTimeRange } = await import(
      './time-range-context'
    )

    const renders: Array<{ lastHours?: number; interval: string }> = []
    let capturedSetRange: ((range: DateRangeValue) => void) | null = null

    function SubscribingWidget() {
      const { lastHours, interval, setRange } = useDashboardTimeRange()
      capturedSetRange = setRange
      renders.push({ lastHours, interval })
      return null
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <DashboardTimeRangeProvider>
          <SubscribingWidget />
        </DashboardTimeRangeProvider>
      )
    })

    expect(renders).toHaveLength(1)
    const initial = renders[0]
    expect(capturedSetRange).not.toBeNull()

    // Simulate the toolbar's DateRangeSelector picking a different range —
    // this is the same setRange the real DateRangeSelector calls.
    act(() => {
      capturedSetRange?.({
        value: '7d',
        lastHours: 24 * 7,
        interval: 'toStartOfHour',
      })
    })

    expect(renders).toHaveLength(2)
    const afterChange = renders[1]

    // The subscribing widget re-rendered with the NEW value, distinct from
    // the initial one — proving the context change actually propagated.
    expect(afterChange.lastHours).toBe(24 * 7)
    expect(afterChange.interval).toBe('toStartOfHour')
    expect(afterChange).not.toEqual(initial)

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  test('useDashboardTimeRange throws outside a DashboardTimeRangeProvider', async () => {
    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    const { useDashboardTimeRange } = await import('./time-range-context')

    function Orphan() {
      useDashboardTimeRange()
      return null
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    // React logs the thrown error to the console during act(); suppress it
    // for this expected-failure assertion only.
    const originalError = console.error
    console.error = () => {}
    try {
      expect(() => {
        act(() => {
          root.render(<Orphan />)
        })
      }).toThrow(/DashboardTimeRangeProvider/)
    } finally {
      console.error = originalError
      container.remove()
    }
  })
})
