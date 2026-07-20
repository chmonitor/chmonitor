/**
 * Renderer tests for the redesigned health report HTML.
 *
 * These are PURE tests — `weekly-report-html.ts` and `fleet-report-html.ts`
 * import nothing from the data-assembly path, so no mocks are needed. Covers:
 * (1) sparkline path generation edge cases (empty, single point, all-zero);
 * (2) the new data sections render when their optional summary fields are
 * present and are OMITTED entirely when absent (backward compatibility with
 * persisted pre-redesign summaries); (3) untrusted text is escaped; (4) the
 * fleet renderer emits the comparison table plus every host's sections.
 */

import type { WeeklyReportSummary } from '../types'

import { renderFleetReportHtml } from '../fleet-report-html'
import { renderWeeklyReportHtml, sparklinePath } from '../weekly-report-html'
import { describe, expect, test } from 'bun:test'

function baseSummary(
  overrides: Partial<WeeklyReportSummary> = {}
): WeeklyReportSummary {
  return {
    hostId: 0,
    hostLabel: 'prod-eu',
    period: 'weekly',
    weekStart: '2026-07-13',
    weekEnd: '2026-07-20',
    generatedAt: '2026-07-20T08:00:00.000Z',
    totalFindings: 2,
    bySeverity: { critical: 1, warning: 1, info: 0 },
    byCategory: { reliability: 1, storage: 1 },
    topFindings: [
      {
        severity: 'critical',
        category: 'reliability',
        title: 'replication lag',
        detail: 'replica behind',
        metric: 'replication_lag',
        generatedAt: '2026-07-19T00:00:00.000Z',
      },
    ],
    baselinesFitted: 3,
    capacity: {
      available: false,
      reason: 'error',
      message: 'forecast unavailable',
    },
    ...overrides,
  }
}

const richSummary = baseSummary({
  queryActivity: {
    totalQueries: 120_000,
    failedQueries: 240,
    p50Ms: 12,
    p95Ms: 480,
    dailyQueries: [
      { date: '2026-07-14', value: 40_000 },
      { date: '2026-07-15', value: 50_000 },
      { date: '2026-07-16', value: 30_000 },
    ],
    dailyFailed: [
      { date: '2026-07-14', value: 100 },
      { date: '2026-07-15', value: 140 },
    ],
  },
  ingestion: {
    totalRows: 9_000_000,
    totalBytes: 5_000_000_000,
    dailyRows: [
      { date: '2026-07-14', value: 4_000_000 },
      { date: '2026-07-15', value: 5_000_000 },
    ],
    dailyBytes: [
      { date: '2026-07-14', value: 2_000_000_000 },
      { date: '2026-07-15', value: 3_000_000_000 },
    ],
  },
  storage: {
    totalBytes: 800_000_000_000,
    totalRows: 12_000_000_000,
    topTables: [
      {
        table: 'default.events',
        bytes: 500_000_000_000,
        rows: 9_000_000_000,
        newBytes: 20_000_000_000,
      },
      {
        table: 'default.<script>alert(1)</script>',
        bytes: 100_000_000_000,
        rows: 1_000_000_000,
        newBytes: 0,
      },
    ],
  },
})

describe('sparklinePath', () => {
  test('empty series yields empty paths', () => {
    expect(sparklinePath([], 600, 80)).toEqual({ line: '', area: '' })
  })

  test('single point renders a flat full-width line and closed area', () => {
    const { line, area } = sparklinePath([5], 600, 80)
    expect(line).toBe('M0,4 L600,4')
    expect(area).toContain('L0,80 Z')
  })

  test('all-zero series sits on the baseline (no NaN from max=0)', () => {
    const { line } = sparklinePath([0, 0, 0], 600, 80)
    expect(line).toBe('M0,76 L300,76 L600,76')
    expect(line).not.toContain('NaN')
  })

  test('multi-point series spans the width with max at the top pad', () => {
    const { line, area } = sparklinePath([0, 10], 100, 80)
    expect(line).toBe('M0,76 L100,4')
    expect(area).toBe('M0,76 L100,4 L100,80 L0,80 Z')
  })
})

describe('renderWeeklyReportHtml (data sections)', () => {
  test('renders query activity, ingestion, and storage when present', () => {
    const html = renderWeeklyReportHtml(richSummary)
    expect(html).toContain('Query activity')
    expect(html).toContain('120.0K') // total queries
    expect(html).toContain('0.2%') // failed pct
    expect(html).toContain('p95 duration')
    expect(html).toContain('Ingestion')
    expect(html).toContain('4.7 GB') // total ingested bytes
    expect(html).toContain('Storage')
    expect(html).toContain('default.events')
    expect(html).toContain('+18.6 GB') // window growth annotation
    // Inline SVG sparklines, self-contained (no external assets).
    expect(html).toContain('<svg class="spark"')
    expect(html).not.toContain('<script src')
    expect(html).not.toContain('<link')
  })

  test('omits the sections entirely for a pre-redesign summary', () => {
    const html = renderWeeklyReportHtml(baseSummary())
    expect(html).not.toContain('Query activity')
    expect(html).not.toContain('Ingestion')
    expect(html).not.toContain('>Storage<')
    expect(html).not.toContain('<svg class="spark"')
    // Legacy sections still render.
    expect(html).toContain('Top findings')
    expect(html).toContain('Capacity outlook')
  })

  test('escapes untrusted table names', () => {
    const html = renderWeeklyReportHtml(richSummary)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('renderFleetReportHtml', () => {
  test('renders the comparison table plus per-host sections', () => {
    const host2 = baseSummary({ hostId: 1, hostLabel: 'staging-us' })
    const html = renderFleetReportHtml([richSummary, host2])
    expect(html).toContain('Fleet overview')
    expect(html).toContain('2 hosts')
    // Comparison cells: real values for the rich host, dashes for the bare one.
    expect(html).toContain('prod-eu')
    expect(html).toContain('staging-us')
    expect(html).toContain('120.0K')
    expect(html).toContain('—')
    // Per-host sections are reused, so the rich host's data appears too.
    expect(html).toContain('default.events')
    expect(html).toContain('Top findings')
    // Self-contained document.
    expect(html).toContain('<!doctype html>')
    expect(html).not.toContain('<script')
  })

  test('handles a single-host fleet without crashing', () => {
    const html = renderFleetReportHtml([baseSummary()])
    expect(html).toContain('1 hosts')
    expect(html).toContain('prod-eu')
  })
})
