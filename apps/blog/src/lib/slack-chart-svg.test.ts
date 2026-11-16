import type { DataVisualizationBlock } from './slack-chart-block'

import { GROUPED_BAR, LINE_WITH_THRESHOLDS, PIE } from './slack-chart-samples'
import { chartHtml } from './slack-chart-svg'
import { describe, expect, test } from 'bun:test'

/** The one <svg> with `variant` in its class, or the only one. */
function svg(html: string, variant = ''): string {
  const all = html.match(/<svg[\s\S]*?<\/svg>/g) ?? []
  const found = all.filter((s) => s.includes(variant))
  if (found.length !== 1)
    throw new Error(`expected one ${variant} svg, got ${found.length}`)
  return found[0]
}

const texts = (markup: string, cls: string) =>
  [
    ...markup.matchAll(
      new RegExp(`<text class="${cls}"[^>]*>([^<]*)</text>`, 'g')
    ),
  ].map((m) => m[1])
const count = (markup: string, pattern: RegExp) =>
  (markup.match(pattern) ?? []).length
const legend = (html: string) =>
  [...html.matchAll(/<li[^>]*><span[^>]*><\/span>([^<]*)<\/li>/g)].map(
    (m) => m[1]
  )

describe('chartHtml, line chart with warn and crit series', () => {
  const html = chartHtml(LINE_WITH_THRESHOLDS)
  const wide = svg(html, 'slack-chart-wide')
  const narrow = svg(html, 'slack-chart-narrow')

  test('shows the title above the chart and names the image after it', () => {
    expect(html).toContain(
      '<p class="slack-chart-title">Disk used on prod-ch-1</p>'
    )
    expect(wide).toContain('role="img"')
    expect(wide).toContain('<title>Disk used on prod-ch-1</title>')
  })

  test('describes min, max and last of each series for screen readers', () => {
    expect(wide).toContain(
      '<desc>Line chart, 20 points from 08:12 to 09:47. x: Time (UTC). y: Disk used (%). Disk used: min 71, max 96, last 96. warn: 80. crit: 95.</desc>'
    )
  })

  test('y ticks are round steps that cover every series', () => {
    expect(texts(wide, 'slack-chart-tick slack-chart-y')).toEqual([
      '70',
      '80',
      '90',
      '100',
    ])
  })

  test('x ticks are thinned to fit and always keep the latest category', () => {
    expect(texts(wide, 'slack-chart-tick slack-chart-x')).toEqual([
      '08:17',
      '08:27',
      '08:37',
      '08:47',
      '08:57',
      '09:07',
      '09:17',
      '09:27',
      '09:37',
      '09:47',
    ])
    expect(texts(narrow, 'slack-chart-tick slack-chart-x')).toEqual([
      '08:32',
      '08:57',
      '09:22',
      '09:47',
    ])
  })

  test('draws one line per series, the thresholds dashed and labelled at the right', () => {
    expect(count(wide, /<path class="slack-chart-line/g)).toBe(3)
    expect(
      count(wide, /<path class="slack-chart-line slack-chart-dashed"/g)
    ).toBe(2)
    expect(count(wide, /<path class="slack-chart-area/g)).toBe(0)
    expect(texts(wide, 'slack-chart-threshold')).toEqual(['warn 80', 'crit 95'])
    expect(texts(wide, 'slack-chart-value')).toEqual(['96'])
    const solid = wide.indexOf('<path class="slack-chart-line" ')
    expect(solid).toBeGreaterThan(wide.lastIndexOf('slack-chart-dashed'))
  })

  test('axis titles come from x_label and y_label', () => {
    expect(texts(wide, 'slack-chart-axis-title')).toEqual([
      'Time (UTC)',
      'Disk used (%)',
    ])
  })

  test('the legend lists every series in order', () => {
    expect(legend(html)).toEqual(['Disk used', 'warn', 'crit'])
  })
})

describe('chartHtml, bar chart', () => {
  const html = chartHtml(GROUPED_BAR)
  const wide = svg(html, 'slack-chart-wide')

  test('groups one bar per series inside each category', () => {
    expect(count(wide, /<rect class="slack-chart-bar"/g)).toBe(6)
    expect(texts(wide, 'slack-chart-tick slack-chart-x')).toEqual([
      'prod-ch-1',
      'prod-ch-2',
      'prod-ch-3',
    ])
  })

  test('bars start at zero, and points are matched to categories by label', () => {
    expect(texts(wide, 'slack-chart-tick slack-chart-y')).toEqual([
      '0',
      '20',
      '40',
      '60',
    ])
    expect(wide).toContain(
      '<desc>Bar chart, 3 points from prod-ch-1 to prod-ch-3. y: Failed queries. today: min 7, max 42, last 19. yesterday: min 9, max 30, last 12.</desc>'
    )
    expect(legend(html)).toEqual(['today', 'yesterday'])
  })

  test('a negative value extends the y range below zero', () => {
    const block: DataVisualizationBlock = {
      type: 'data_visualization',
      title: 'Free disk change (GB)',
      chart: {
        type: 'bar',
        series: [
          {
            name: 'change',
            data: [
              { label: 'Mon', value: -3 },
              { label: 'Tue', value: 5 },
            ],
          },
        ],
        axis_config: { categories: ['Mon', 'Tue'] },
      },
    }
    const out = chartHtml(block)
    expect(
      texts(svg(out, 'slack-chart-wide'), 'slack-chart-tick slack-chart-y')
    ).toEqual(['-4', '-2', '0', '2', '4', '6'])
    expect(out).not.toContain('<ul')
  })
})

describe('chartHtml, area chart', () => {
  const block: DataVisualizationBlock = {
    type: 'data_visualization',
    title: 'Daily Active Users',
    chart: {
      type: 'area',
      series: ['Free Tier', 'Paid Tier'].map((name, s) => ({
        name,
        data: ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri'].map((label, i) => ({
          label,
          value:
            s === 0
              ? [12000, 13500, 15200, 14800, 16400][i]
              : [4500, 4800, 5100, 5600, 6200][i],
        })),
      })),
      axis_config: {
        categories: ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri'],
        x_label: 'Day',
        y_label: 'Users',
      },
    },
  }
  const wide = svg(chartHtml(block), 'slack-chart-wide')

  test('fills each series from zero, first series at the back', () => {
    expect(count(wide, /<path class="slack-chart-area/g)).toBe(2)
    expect(texts(wide, 'slack-chart-tick slack-chart-y')).toEqual([
      '0',
      '5K',
      '10K',
      '15K',
      '20K',
    ])
    const areas = [
      ...wide.matchAll(
        /<path class="slack-chart-area"[^>]*style="--c: ([^"]*)"/g
      ),
    ]
    expect(areas.map((m) => m[1])).toEqual([
      'color-mix(in oklab, var(--slack-chart-series) 100%, var(--card))',
      'color-mix(in oklab, var(--slack-chart-series) 80%, var(--card))',
    ])
  })
})

describe('chartHtml, pie chart', () => {
  test('one slice per segment, shares in the legend', () => {
    const html = chartHtml(PIE)
    expect(count(svg(html), /<path class="slack-chart-slice"/g)).toBe(3)
    expect(legend(html)).toEqual([
      'disk-usage 50%',
      'replication-lag 33%',
      'merges 17%',
    ])
    expect(svg(html)).toContain(
      '<desc>Pie chart of 3 slices: disk-usage 50% (3), replication-lag 33% (2), merges 17% (1).</desc>'
    )
  })

  test('a single segment is a full circle, not an empty arc', () => {
    const html = chartHtml({
      type: 'data_visualization',
      title: 'All one rule',
      chart: { type: 'pie', segments: [{ label: 'disk-usage', value: 4 }] },
    })
    expect(count(svg(html), /<circle class="slack-chart-slice"/g)).toBe(1)
    expect(count(svg(html), /<path/g)).toBe(0)
    expect(legend(html)).toEqual(['disk-usage 100%'])
  })
})

test('text from the block is escaped', () => {
  const html = chartHtml({
    type: 'data_visualization',
    title: '<script>x</script> & co',
    chart: { type: 'pie', segments: [{ label: '<b>', value: 1 }] },
  })
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<b>')
  expect(html).toContain(
    '<title>&lt;script&gt;x&lt;/script&gt; &amp; co</title>'
  )
  expect(legend(html)).toEqual(['&lt;b&gt; 100%'])
})

describe('chartHtml, line smoothing', () => {
  const lineChart = (values: number[]): DataVisualizationBlock => {
    const categories = values.map((_, i) => `t${i}`)
    return {
      type: 'data_visualization',
      title: 'Smooth',
      chart: {
        type: 'line',
        series: [
          {
            name: 'v',
            data: categories.map((label, i) => ({ label, value: values[i] })),
          },
        ],
        axis_config: { categories },
      },
    }
  }
  const paths = (markup: string, cls: string) =>
    [
      ...markup.matchAll(new RegExp(`<path class="${cls}" d="([^"]*)"`, 'g')),
    ].map((m) => m[1])
  const ys = (d: string) =>
    [...d.matchAll(/-?[\d.]+ (-?[\d.]+)/g)].map((m) => Number(m[1]))

  test('a line is a monotone cubic through each point, flat at the peak', () => {
    const wide = svg(chartHtml(lineChart([1, 5, 1])), 'slack-chart-wide')
    expect(paths(wide, 'slack-chart-line')).toEqual([
      'M40 176 C124.7 120.7 209.3 10 294 10 C378.7 10 463.3 120.7 548 176',
    ])
  })

  test('no curve bends past the points at either end of its segment', () => {
    const wide = svg(
      chartHtml(lineChart([3, 9, 2, 2, 8, 7, 1, 6])),
      'slack-chart-wide'
    )
    const [d] = paths(wide, 'slack-chart-line')
    const segments = [...d.matchAll(/C([^C]*)/g)].map((m) =>
      m[1].trim().split(' ').map(Number)
    )
    expect(segments).toHaveLength(7)
    let start = ys(d)[0]
    for (const [, c1, , c2, , end] of segments) {
      const [lo, hi] = [Math.min(start, end), Math.max(start, end)]
      for (const c of [c1, c2]) {
        expect(c).toBeGreaterThanOrEqual(lo)
        expect(c).toBeLessThanOrEqual(hi)
      }
      start = end
    }
  })

  test('the warn and crit lines stay straight and level', () => {
    const wide = svg(chartHtml(LINE_WITH_THRESHOLDS), 'slack-chart-wide')
    const dashed = paths(wide, 'slack-chart-line slack-chart-dashed')
    expect(dashed.map((d) => [...new Set(ys(d))])).toEqual([[108.7], [34.7]])
  })

  test('area charts keep straight segments', () => {
    const block = lineChart([1, 5, 1])
    const area = { ...block, chart: { ...block.chart, type: 'area' } }
    const wide = svg(
      chartHtml(area as DataVisualizationBlock),
      'slack-chart-wide'
    )
    expect(paths(wide, 'slack-chart-line')).toEqual([
      'M40 148.3 L294 37.7 L548 148.3',
    ])
  })
})
