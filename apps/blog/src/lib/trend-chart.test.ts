import { trendLayout } from './trend-chart'
import { describe, expect, test } from 'bun:test'

const box = { width: 110, height: 45, top: 0, right: 0, bottom: 10, left: 10 }

describe('trendLayout', () => {
  test('the y range covers both thresholds, rounded out to 5', () => {
    const layout = trendLayout(
      { series: [70, 84], warn: 80, crit: 95, unit: '%', stepMinutes: 5 },
      box
    )
    expect(layout).toMatchObject({
      lo: 65,
      hi: 100,
      line: 'M10 30 L110 16',
      area: 'M10 30 L110 16 L110 35 L10 35 Z',
      warnY: 20,
      critY: 5,
      last: { x: 110, y: 16, value: 84 },
    })
  })

  test('one reading and a flat range still draw inside the box', () => {
    const layout = trendLayout(
      { series: [50], warn: 50, crit: 50, unit: '%', stepMinutes: 5 },
      box
    )
    expect([layout.lo, layout.hi, layout.line]).toEqual([50, 55, 'M10 35'])
  })
})
