import type { DashboardWidget } from './dashboard-layout'

import {
  DEFAULT_CHART_WIDGET_H,
  DEFAULT_CHART_WIDGET_W,
  findFreePosition,
  GRID_COLUMNS,
  isValidWidget,
  normalizeLayout,
  widgetsCollide,
} from './dashboard-layout'
import { describe, expect, it } from 'bun:test'

describe('isValidWidget', () => {
  it('accepts a minimal valid chart widget', () => {
    expect(
      isValidWidget({
        id: 'w1',
        type: 'chart',
        chartName: 'query-count',
        x: 0,
        y: 0,
        w: 6,
        h: 4,
      })
    ).toBe(true)
  })

  it('accepts all four widget types', () => {
    for (const type of ['chart', 'table', 'stat', 'text']) {
      expect(isValidWidget({ id: 'w', type, x: 0, y: 0, w: 2, h: 2 })).toBe(
        true
      )
    }
  })

  it('rejects a non-object', () => {
    expect(isValidWidget(null)).toBe(false)
    expect(isValidWidget('chart')).toBe(false)
    expect(isValidWidget(42)).toBe(false)
  })

  it('rejects an unknown widget type', () => {
    expect(
      isValidWidget({ id: 'w', type: 'bogus', x: 0, y: 0, w: 2, h: 2 })
    ).toBe(false)
  })

  it('rejects missing/invalid id', () => {
    expect(isValidWidget({ type: 'chart', x: 0, y: 0, w: 2, h: 2 })).toBe(false)
    expect(
      isValidWidget({ id: '', type: 'chart', x: 0, y: 0, w: 2, h: 2 })
    ).toBe(false)
  })

  it('rejects negative or non-integer coordinates', () => {
    expect(
      isValidWidget({ id: 'w', type: 'chart', x: -1, y: 0, w: 2, h: 2 })
    ).toBe(false)
    expect(
      isValidWidget({ id: 'w', type: 'chart', x: 0.5, y: 0, w: 2, h: 2 })
    ).toBe(false)
  })

  it('rejects width/height below the minimum', () => {
    expect(
      isValidWidget({ id: 'w', type: 'chart', x: 0, y: 0, w: 1, h: 2 })
    ).toBe(false)
    expect(
      isValidWidget({ id: 'w', type: 'chart', x: 0, y: 0, w: 2, h: 1 })
    ).toBe(false)
  })

  it('rejects a widget wider than the grid from its x position', () => {
    expect(
      isValidWidget({ id: 'w', type: 'chart', x: 10, y: 0, w: 6, h: 2 })
    ).toBe(false)
  })

  it('accepts a widget spanning exactly to the grid edge', () => {
    expect(
      isValidWidget({
        id: 'w',
        type: 'chart',
        x: GRID_COLUMNS - 4,
        y: 0,
        w: 4,
        h: 2,
      })
    ).toBe(true)
  })

  it('rejects wrong-typed chartName/queryConfigName/title/props', () => {
    expect(
      isValidWidget({
        id: 'w',
        type: 'chart',
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        chartName: 123,
      })
    ).toBe(false)
    expect(
      isValidWidget({
        id: 'w',
        type: 'table',
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        queryConfigName: 123,
      })
    ).toBe(false)
    expect(
      isValidWidget({ id: 'w', type: 'text', x: 0, y: 0, w: 2, h: 2, title: 1 })
    ).toBe(false)
    expect(
      isValidWidget({
        id: 'w',
        type: 'text',
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        props: 'nope',
      })
    ).toBe(false)
  })

  it('accepts optional props as a record', () => {
    expect(
      isValidWidget({
        id: 'w',
        type: 'text',
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        props: { markdown: '# hi' },
      })
    ).toBe(true)
  })
})

describe('normalizeLayout — round trip', () => {
  it('round-trips a layout with 2+ widgets of different types (serialize → deserialize, structurally equal)', () => {
    const layout = {
      widgets: [
        {
          id: 'w1',
          type: 'chart' as const,
          chartName: 'query-count',
          x: 0,
          y: 0,
          w: 6,
          h: 4,
        },
        {
          id: 'w2',
          type: 'table' as const,
          queryConfigName: 'merges',
          title: 'Merges',
          x: 6,
          y: 0,
          w: 6,
          h: 4,
          props: { pageSize: 5 },
        },
        {
          id: 'w3',
          type: 'stat' as const,
          title: 'Total rows',
          x: 0,
          y: 4,
          w: 3,
          h: 2,
          props: { statQuery: 'SELECT count() AS c FROM system.tables' },
        },
        {
          id: 'w4',
          type: 'text' as const,
          x: 3,
          y: 4,
          w: 3,
          h: 2,
          props: { markdown: '**hello**' },
        },
      ],
    }

    const serialized = JSON.stringify(layout)
    const deserialized = normalizeLayout(JSON.parse(serialized))

    expect(deserialized).toEqual(layout)
  })

  it('drops an individually-invalid widget but keeps the rest of the layout', () => {
    const input = {
      widgets: [
        { id: 'ok', type: 'chart', x: 0, y: 0, w: 6, h: 4 },
        { id: 'bad', type: 'not-a-type', x: 0, y: 0, w: 6, h: 4 },
      ],
    }
    expect(normalizeLayout(input)).toEqual({
      widgets: [{ id: 'ok', type: 'chart', x: 0, y: 0, w: 6, h: 4 }],
    })
  })
})

describe('normalizeLayout — legacy back-compat', () => {
  it('converts a bare string[] of chart names into one chart widget per name, 2-per-row', () => {
    const legacy = ['query-count', 'merge-count', 'cpu-usage']
    const result = normalizeLayout(legacy)

    expect(result.widgets).toHaveLength(3)
    expect(result.widgets.every((w) => w.type === 'chart')).toBe(true)
    expect(result.widgets.map((w) => w.chartName)).toEqual(legacy)

    // 2-per-row placement, matching the pre-plan-57 2-col CSS grid.
    expect(result.widgets[0]).toMatchObject({ x: 0, y: 0 })
    expect(result.widgets[1]).toMatchObject({
      x: DEFAULT_CHART_WIDGET_W,
      y: 0,
    })
    expect(result.widgets[2]).toMatchObject({
      x: 0,
      y: DEFAULT_CHART_WIDGET_H,
    })

    // Every legacy widget stays within the grid and satisfies isValidWidget.
    for (const w of result.widgets) {
      expect(isValidWidget(w)).toBe(true)
    }
  })

  it('converts an empty string[] into an empty layout', () => {
    expect(normalizeLayout([])).toEqual({ widgets: [] })
  })
})

describe('normalizeLayout — fallback', () => {
  it('falls back to an empty layout for null', () => {
    expect(normalizeLayout(null)).toEqual({ widgets: [] })
  })

  it('falls back to an empty layout for a non-array, non-layout object', () => {
    expect(normalizeLayout({ foo: 'bar' })).toEqual({ widgets: [] })
  })

  it('falls back to an empty layout for a primitive', () => {
    expect(normalizeLayout(42)).toEqual({ widgets: [] })
    expect(normalizeLayout('oops')).toEqual({ widgets: [] })
  })

  it('falls back to an empty layout when widgets is not an array', () => {
    expect(normalizeLayout({ widgets: 'nope' })).toEqual({ widgets: [] })
  })

  it('never throws on malformed input', () => {
    expect(() => normalizeLayout(undefined)).not.toThrow()
    expect(() => normalizeLayout([1, 2, 3])).not.toThrow()
    expect(() =>
      normalizeLayout({ widgets: [null, undefined, 1, 'x'] })
    ).not.toThrow()
  })
})

function w(
  partial: Partial<DashboardWidget> &
    Pick<DashboardWidget, 'id' | 'x' | 'y' | 'w' | 'h'>
): DashboardWidget {
  return { type: 'chart', ...partial }
}

describe('widgetsCollide', () => {
  it('is false for a widget against an empty list', () => {
    expect(widgetsCollide({ id: 'a', x: 0, y: 0, w: 4, h: 4 }, [])).toBe(false)
  })

  it('is false for non-overlapping rectangles', () => {
    const others = [w({ id: 'b', x: 4, y: 0, w: 4, h: 4 })]
    expect(widgetsCollide({ id: 'a', x: 0, y: 0, w: 4, h: 4 }, others)).toBe(
      false
    )
  })

  it('is true for overlapping rectangles', () => {
    const others = [w({ id: 'b', x: 2, y: 2, w: 4, h: 4 })]
    expect(widgetsCollide({ id: 'a', x: 0, y: 0, w: 4, h: 4 }, others)).toBe(
      true
    )
  })

  it('ignores a widget colliding with itself (same id)', () => {
    const others = [w({ id: 'a', x: 0, y: 0, w: 4, h: 4 })]
    expect(widgetsCollide({ id: 'a', x: 0, y: 0, w: 4, h: 4 }, others)).toBe(
      false
    )
  })

  it('treats edge-touching rectangles as non-colliding', () => {
    // widget B starts exactly where A ends — adjacent, not overlapping.
    const others = [w({ id: 'b', x: 4, y: 0, w: 4, h: 4 })]
    expect(widgetsCollide({ id: 'a', x: 0, y: 0, w: 4, h: 4 }, others)).toBe(
      false
    )
  })
})

describe('findFreePosition', () => {
  it('places the first widget at the origin', () => {
    expect(findFreePosition([], 6, 4)).toEqual({ x: 0, y: 0 })
  })

  it('packs a second widget next to the first when it fits the same row', () => {
    const existing = [w({ id: 'a', x: 0, y: 0, w: 6, h: 4 })]
    expect(findFreePosition(existing, 6, 4)).toEqual({ x: 6, y: 0 })
  })

  it('starts a new row when the current row is full', () => {
    const existing = [
      w({ id: 'a', x: 0, y: 0, w: 6, h: 4 }),
      w({ id: 'b', x: 6, y: 0, w: 6, h: 4 }),
    ]
    expect(findFreePosition(existing, 6, 4)).toEqual({ x: 0, y: 4 })
  })

  it('fills a gap left by a smaller widget instead of always appending', () => {
    const existing = [
      w({ id: 'a', x: 0, y: 0, w: 4, h: 4 }), // leaves x=4..12 free on row 0
    ]
    expect(findFreePosition(existing, 4, 4)).toEqual({ x: 4, y: 0 })
  })

  it('returns a position that never collides with any existing widget', () => {
    const existing = [
      w({ id: 'a', x: 0, y: 0, w: 6, h: 4 }),
      w({ id: 'b', x: 6, y: 0, w: 6, h: 4 }),
      w({ id: 'c', x: 0, y: 4, w: 3, h: 2 }),
    ]
    const { x, y } = findFreePosition(existing, 3, 2)
    expect(widgetsCollide({ id: '__new__', x, y, w: 3, h: 2 }, existing)).toBe(
      false
    )
  })
})
