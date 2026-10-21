/**
 * The chart primitives must hand ChartContainer a referentially stable
 * `config` (and, in log scale, run `clampDataForLogScale` once) across
 * re-renders with equal props; otherwise downstream memoization is defeated.
 * Counts real clamp calls and records the `config` identity ChartContainer
 * receives, through the real components.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as Record<string, unknown>).ResizeObserver =
    FakeResizeObserver
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

async function mount(render: (n: number) => React.ReactElement) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  return {
    draw: (n: number) =>
      act(async () => {
        root.render(render(n))
      }),
    cleanup: () =>
      act(async () => {
        root.unmount()
        await new Promise((r) => setTimeout(r, 0))
      }),
  }
}

/**
 * Records every `config` prop the real ChartContainer receives. It is a
 * forwardRef component, so wrap its `render` function in place.
 */
async function spyConfigs() {
  const { ChartContainer } = await import('@/components/ui/chart')
  const target = ChartContainer as unknown as {
    render: (p: { config: unknown }, ref: unknown) => unknown
  }
  const original = target.render
  const seen: unknown[] = []
  target.render = (p, ref) => {
    seen.push(p.config)
    return original(p, ref)
  }
  return {
    seen,
    restore: () => {
      target.render = original
    },
  }
}

const data = [
  { t: '1', v: 0 },
  { t: '2', v: 10 },
  { t: '3', v: 1000 },
]

describe('AreaChart memoization', () => {
  test('log scale: clamp runs once and config is stable across re-renders', async () => {
    const scale = await import('@/lib/chart-scale')
    const clamp = spyOn(scale, 'clampDataForLogScale')
    const { AreaChart } = await import('./area')
    const cfg = await spyConfigs()
    const categories = ['v']
    const colors = ['--chart-1']
    const { draw, cleanup } = await mount((n) => (
      <div data-n={n}>
        <AreaChart
          data={data}
          index="t"
          categories={categories}
          colors={colors}
          yAxisScale="log"
        />
      </div>
    ))
    await draw(0)
    const callsAfterFirst = clamp.mock.calls.length
    const rendersAfterFirst = cfg.seen.length
    for (let i = 1; i <= 5; i++) await draw(i)

    expect(callsAfterFirst).toBeGreaterThan(0)
    expect(cfg.seen.length).toBeGreaterThan(rendersAfterFirst)
    expect(clamp.mock.calls.length).toBe(callsAfterFirst)
    expect(new Set(cfg.seen).size).toBe(1)

    await cleanup()
    cfg.restore()
    clamp.mockRestore()
  })

  test('a new data identity recomputes the clamp; new categories recompute config', async () => {
    const scale = await import('@/lib/chart-scale')
    const clamp = spyOn(scale, 'clampDataForLogScale')
    const { AreaChart } = await import('./area')
    const cfg = await spyConfigs()
    const cats = ['v']
    const { draw, cleanup } = await mount((n) => (
      <AreaChart
        data={n < 2 ? data : [...data]}
        index="t"
        categories={n < 3 ? cats : ['v']}
        yAxisScale="log"
      />
    ))
    await draw(0)
    await draw(1)
    const stableCalls = clamp.mock.calls.length
    await draw(2)
    expect(clamp.mock.calls.length).toBeGreaterThan(stableCalls)
    const before = new Set(cfg.seen).size
    await draw(3)
    expect(new Set(cfg.seen).size).toBeGreaterThan(before)

    await cleanup()
    cfg.restore()
    clamp.mockRestore()
  })
})

describe('RadialChart / BarChart config memoization', () => {
  test('RadialChart config is stable for equal props, new when data changes', async () => {
    const { RadialChart } = await import('./radial')
    const cfg = await spyConfigs()
    const rows = [{ name: 'a', value: 1 }]
    const { draw, cleanup } = await mount((n) => (
      <RadialChart
        data={n < 3 ? rows : [{ name: 'b', value: 2 }]}
        nameKey="name"
        dataKey="value"
      />
    ))
    await draw(0)
    await draw(1)
    await draw(2)
    expect(cfg.seen.length).toBeGreaterThanOrEqual(3)
    expect(new Set(cfg.seen).size).toBe(1)
    await draw(3)
    expect(new Set(cfg.seen).size).toBe(2)

    await cleanup()
    cfg.restore()
  })

  test('BarChart config is stable for equal props, new when categories change', async () => {
    const { BarChart } = await import('./bar/bar')
    const cfg = await spyConfigs()
    const cats = ['v']
    const { draw, cleanup } = await mount((n) => (
      <BarChart data={data} index="t" categories={n < 3 ? cats : ['v', 'w']} />
    ))
    await draw(0)
    await draw(1)
    await draw(2)
    expect(cfg.seen.length).toBeGreaterThanOrEqual(3)
    expect(new Set(cfg.seen).size).toBe(1)
    await draw(3)
    expect(new Set(cfg.seen).size).toBe(2)

    await cleanup()
    cfg.restore()
  })
})
