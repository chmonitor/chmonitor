/**
 * Regression coverage for "log scale area chart becomes a line chart".
 *
 * Recharts maps zero/negative values to `null` on a log y-axis (log(0) is
 * undefined). On an Area chart that breaks the filled polygon into
 * disconnected slivers around every such point instead of one continuous
 * shape — the SVG `d` attribute fragments into separate `M…Z` subpaths, each
 * degenerate (a single point straight down to the baseline), so the fill
 * visually disappears and only isolated stroke marks remain.
 *
 * A pure unit test of `clampDataForLogScale` (see `lib/chart-scale.test.ts`)
 * can't catch a regression where the clamp is removed from `area.tsx` but
 * the function itself still works — this renders the real `AreaChart`
 * component through Recharts and inspects the resulting SVG path, the same
 * way `tooltip-breakdown-section.test.tsx` and
 * `recent-query-expanded-details.test.tsx` use the repo's one-off happy-dom
 * harness (components are otherwise covered by Cypress).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  // happy-dom's ResizeObserver never fires without real layout, and
  // Recharts' ResponsiveContainer needs a non-zero size to render anything.
  class FakeResizeObserver {
    cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe(target: Element) {
      queueMicrotask(() => {
        this.cb(
          [
            {
              target,
              contentRect: { width: 600, height: 300 },
            } as unknown as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver
        )
      })
    }
    unobserve() {}
    disconnect() {}
  }
  // biome-ignore lint/suspicious/noExplicitAny: test shim assigning to globalThis
  ;(globalThis as any).ResizeObserver = FakeResizeObserver
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

async function renderAreaChart(props: {
  data: Record<string, unknown>[]
  categories: string[]
  stack?: boolean
}): Promise<{ html: string; cleanup: () => Promise<void> }> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { AreaChart } = await import('./area.tsx')

  const container = document.createElement('div')
  container.style.width = '600px'
  container.style.height = '300px'
  document.body.appendChild(container)
  // biome-ignore lint/suspicious/noExplicitAny: test shim forcing non-zero layout
  ;(container as any).getBoundingClientRect = () => ({
    width: 600,
    height: 300,
    top: 0,
    left: 0,
    right: 600,
    bottom: 300,
    x: 0,
    y: 0,
    toJSON() {},
  })
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <div style={{ width: 600, height: 300 }}>
        <AreaChart
          data={props.data}
          index="t"
          categories={props.categories}
          yAxisScale="log"
          stack={props.stack}
        />
      </div>
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  return {
    html: container.innerHTML,
    // React's scheduler (MessageChannel-based) can still have pending work
    // queued from ResponsiveContainer/ResizeObserver at the moment of
    // unmount; flushing it here (inside `act`, with a macrotask tick)
    // keeps it from firing later — after `afterAll` tears down happy-dom —
    // which would otherwise surface as an unhandled `window is not
    // defined` error and fail the whole test file.
    cleanup: async () => {
      await act(async () => {
        root.unmount()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      container.remove()
    },
  }
}

/** Extracts every `d` attribute from `<path class="… recharts-area-area">` fill elements. */
function extractAreaFillPaths(html: string): string[] {
  return [
    ...html.matchAll(
      /class="recharts-curve recharts-area-area"[^>]*d="([^"]*)"/g
    ),
  ].map((m) => m[1] as string)
}

describe('AreaChart log scale (regression: fill must stay continuous)', () => {
  test('data with zero values still renders one continuous fill path', async () => {
    // Matches a real-world metric that sits at zero between spikes (e.g. an
    // error count) — exactly the high max/min ratio that benefits from log
    // scale, and exactly the shape that broke before the fix.
    const { html, cleanup } = await renderAreaChart({
      data: [
        { t: '1', v: 0 },
        { t: '2', v: 10 },
        { t: '3', v: 0 },
        { t: '4', v: 1000 },
      ],
      categories: ['v'],
    })

    try {
      const fills = extractAreaFillPaths(html)
      expect(fills.length).toBe(1)
      const d = fills[0] as string
      // A broken fill fragments into multiple "M...Z" subpaths (one per
      // isolated valid point); a working fill is a single closed polygon.
      expect(d.match(/Z/g)?.length).toBe(1)
      expect(d).not.toContain('NaN')
      expect(d.endsWith('Z')).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test('data with negative values still renders one continuous fill path', async () => {
    const { html, cleanup } = await renderAreaChart({
      data: [
        { t: '1', v: -5 },
        { t: '2', v: 20 },
        { t: '3', v: 500 },
      ],
      categories: ['v'],
    })

    try {
      const fills = extractAreaFillPaths(html)
      expect(fills.length).toBe(1)
      expect(fills[0]?.match(/Z/g)?.length).toBe(1)
      expect(fills[0]).not.toContain('NaN')
    } finally {
      await cleanup()
    }
  })

  test('all-positive data still renders correctly (no regression for the common case)', async () => {
    const { html, cleanup } = await renderAreaChart({
      data: [
        { t: '1', v: 1 },
        { t: '2', v: 10 },
        { t: '3', v: 100 },
        { t: '4', v: 1000 },
      ],
      categories: ['v'],
    })

    try {
      const fills = extractAreaFillPaths(html)
      expect(fills.length).toBe(1)
      expect(fills[0]?.match(/Z/g)?.length).toBe(1)
    } finally {
      await cleanup()
    }
  })

  test('stacked series with zero values fall back to linear instead of rendering empty', async () => {
    // Recharts derives a stacked series' baseline from the d3 cumulative
    // stack sum, which always starts at 0 regardless of the underlying
    // data — clamping data values can't reach that baseline, so log scale
    // is unsupported for stacked Area charts (see chart-scale.ts). Falling
    // back to linear keeps every series rendering instead of leaving the
    // bottom-most one with no path at all.
    const { html, cleanup } = await renderAreaChart({
      data: [
        { t: '1', a: 0, b: 5 },
        { t: '2', a: 10, b: 20 },
        { t: '3', a: 0, b: 0 },
        { t: '4', a: 1000, b: 50 },
      ],
      categories: ['a', 'b'],
      stack: true,
    })

    try {
      const fills = extractAreaFillPaths(html)
      // Both the bottom ('a') and top ('b') stacked series must have a
      // non-empty, finite fill path.
      expect(fills.length).toBe(2)
      for (const d of fills) {
        expect(d.length).toBeGreaterThan(0)
        expect(d).not.toContain('NaN')
      }
    } finally {
      await cleanup()
    }
  })
})
