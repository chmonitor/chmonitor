import type { HeatmapDayRow } from './query-count-calendar'

import {
  buildCalendarModel,
  buildMonthBlocks,
  buildMonthWindowModel,
  buildStatCards,
  formatCalendarDate,
  formatDurationMs,
  getIntensityClass,
  isoDate,
  METRIC_CONFIGS,
  pickVisibleMonthBlocks,
  resolveWindowStart,
  summarizeVisibleBlocks,
} from './query-count-calendar'
import { describe, expect, it } from 'bun:test'

const QUERIES = METRIC_CONFIGS.queries

/** Build a full day row, overriding only the metrics a test cares about. */
function row(date: string, over: Partial<HeatmapDayRow> = {}): HeatmapDayRow {
  return {
    date,
    query_count: 0,
    failed_count: 0,
    memory_peak: 0,
    avg_duration_ms: 0,
    written_bytes: 0,
    ...over,
  }
}

describe('getIntensityClass', () => {
  it('returns the empty tier for zero value or zero max', () => {
    expect(getIntensityClass(0, 100)).toBe('bg-muted/50')
    expect(getIntensityClass(50, 0)).toBe('bg-muted/50')
  })

  it('maps the peak value to the densest tier', () => {
    expect(getIntensityClass(100, 100)).toBe('bg-chart-2')
  })

  it('maps a mid ratio to a middle tier (walks thresholds down)', () => {
    // ratio 0.5 → threshold 0.5 (index 3) → tier index 4
    expect(getIntensityClass(50, 100)).toBe('bg-chart-2/80')
    // ratio 0.25 → threshold 0.25 (index 2) → tier index 3
    expect(getIntensityClass(25, 100)).toBe('bg-chart-2/60')
  })

  it('maps a tiny non-zero ratio to the first active tier, never the empty tier', () => {
    // ratio 0.001 ≥ first active threshold 0.01? No → but > 0, so tier 1.
    expect(getIntensityClass(1, 1000)).toBe('bg-chart-2/20')
  })

  it('uses the per-metric ramp when one is supplied', () => {
    expect(getIntensityClass(100, 100, METRIC_CONFIGS.failed.tiers)).toBe(
      'bg-rose-500'
    )
    expect(getIntensityClass(1, 1000, METRIC_CONFIGS.written.tiers)).toBe(
      'bg-emerald-500/20'
    )
  })
})

describe('isoDate', () => {
  it('formats a local date as YYYY-MM-DD with zero padding', () => {
    expect(isoDate(new Date(2024, 0, 5, 13, 0, 0))).toBe('2024-01-05')
    expect(isoDate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('formatCalendarDate', () => {
  it('renders weekday, month, day, and year from local components', () => {
    // Fri Jan 5 2024
    expect(formatCalendarDate(new Date(2024, 0, 5))).toBe('Fri, Jan 5 2024')
  })
})

describe('formatDurationMs', () => {
  it('formats sub-second values as milliseconds', () => {
    expect(formatDurationMs(0)).toBe('0ms')
    expect(formatDurationMs(420)).toBe('420ms')
  })

  it('formats seconds with one decimal under 10s and whole seconds above', () => {
    expect(formatDurationMs(1800)).toBe('1.8s')
    expect(formatDurationMs(18400)).toBe('18s')
  })
})

describe('buildCalendarModel', () => {
  // Anchor "today" to a fixed Wednesday so the grid shape is deterministic.
  const today = new Date(2026, 5, 17) // Wed Jun 17 2026

  it('lays out whole Sunday-first weeks and ends on today', () => {
    const model = buildCalendarModel([], today, QUERIES, 4)
    // Every column has 7 slots.
    for (const week of model.weeks) {
      expect(week).toHaveLength(7)
    }
    // The first slot of the first column is a Sunday.
    const firstDay = model.weeks[0].find(Boolean)
    expect(firstDay?.date.getDay()).toBe(0)
    // The most recent non-null day is today.
    const lastNonNull = model.weeks
      .flat()
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .at(-1)
    expect(lastNonNull?.iso).toBe('2026-06-17')
  })

  it('leaves future slots in the trailing column as null', () => {
    const model = buildCalendarModel([], today, QUERIES, 4)
    const lastWeek = model.weeks.at(-1)
    // today is Wednesday (dow 3) → Thu/Fri/Sat slots are future → null.
    expect(lastWeek?.[4]).toBeNull()
    expect(lastWeek?.[5]).toBeNull()
    expect(lastWeek?.[6]).toBeNull()
    // Wednesday (today) is present.
    expect(lastWeek?.[3]?.iso).toBe('2026-06-17')
  })

  describe('includeFuture', () => {
    it('renders the rest of the current month as dimmed future days', () => {
      const model = buildCalendarModel([], today, QUERIES, 4, true)
      const days = model.weeks
        .flat()
        .filter((d): d is NonNullable<typeof d> => d !== null)
      // The grid now extends to the last day of the current month (Jun 30).
      expect(days.at(-1)?.iso).toBe('2026-06-30')
      // Today is not future; tomorrow is.
      expect(days.find((d) => d.iso === '2026-06-17')?.isFuture).toBeUndefined()
      expect(days.find((d) => d.iso === '2026-06-18')?.isFuture).toBe(true)
      expect(days.find((d) => d.iso === '2026-06-30')?.isFuture).toBe(true)
    })

    it('excludes future days from totals and the date-range caption', () => {
      const rows: HeatmapDayRow[] = [row('2026-06-17', { query_count: 50 })]
      const withFuture = buildCalendarModel(rows, today, QUERIES, 4, true)
      const withoutFuture = buildCalendarModel(rows, today, QUERIES, 4, false)
      // Future zero-days must not inflate totalDays / change stats.
      expect(withFuture.totalDays).toBe(withoutFuture.totalDays)
      expect(withFuture.total).toBe(50)
      expect(withFuture.activeDays).toBe(1)
      expect(withFuture.rangeLabel).toBe(withoutFuture.rangeLabel)
    })
  })

  it('joins the selected metric onto the matching day and aggregates stats', () => {
    const rows: HeatmapDayRow[] = [
      row('2026-06-15', { query_count: 100 }),
      row('2026-06-16', { query_count: 40 }),
      row('2026-06-17', { query_count: 0 }),
    ]
    const model = buildCalendarModel(rows, today, QUERIES, 4)
    expect(model.total).toBe(140)
    expect(model.max).toBe(100)
    expect(model.activeDays).toBe(2) // zero-count day is not "active"
    expect(model.peak?.iso).toBe('2026-06-15')
    expect(model.avgActive).toBe(70) // 140 / 2 active days
  })

  it('reads a different metric when a different config is passed', () => {
    const rows: HeatmapDayRow[] = [
      row('2026-06-16', { query_count: 999, failed_count: 5 }),
      row('2026-06-17', { query_count: 999, failed_count: 2 }),
    ]
    const model = buildCalendarModel(rows, today, METRIC_CONFIGS.failed, 4)
    // Only failed_count contributes — query_count is ignored for this mode.
    expect(model.total).toBe(7)
    expect(model.max).toBe(5)
    expect(model.peak?.iso).toBe('2026-06-16')
  })

  it('labels each column where a new month begins, once per month', () => {
    // 12 weeks back from mid-June spans Apr→Jun.
    const model = buildCalendarModel([], today, QUERIES, 12)
    const labels = model.monthLabels.filter(Boolean)
    // Months are non-repeating and in calendar order.
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toContain('Jun')
  })

  it('derives a month-year range caption from the rendered span', () => {
    const model = buildCalendarModel([], today, QUERIES, 53)
    expect(model.rangeLabel).toMatch(
      /^[A-Z][a-z]{2} \d{4} – [A-Z][a-z]{2} \d{4}$/
    )
    expect(model.rangeLabel.endsWith('Jun 2026')).toBe(true)
  })
})

describe('buildMonthBlocks', () => {
  const today = new Date(2026, 5, 17) // Wed Jun 17 2026

  it('groups days into one block per month, in chronological order', () => {
    // 12 weeks back from mid-June spans Apr→Jun 2026.
    const model = buildCalendarModel([], today, QUERIES, 12)
    const blocks = buildMonthBlocks(model)

    // The start snaps back to a Sunday, so a partial leading month (Mar) shows.
    const labels = blocks.map((b) => b.label)
    expect(labels).toEqual(['Mar', 'Apr', 'May', 'Jun'])
    // Keys carry the year so blocks stay distinct across a year boundary.
    expect(blocks.map((b) => b.key)).toEqual([
      '2026-2',
      '2026-3',
      '2026-4',
      '2026-5',
    ])
    expect(blocks.every((b) => b.year === 2026)).toBe(true)
  })

  it('keeps every block self-contained: a block only holds its own days', () => {
    const model = buildCalendarModel([], today, QUERIES, 12)
    for (const block of buildMonthBlocks(model)) {
      const month = Number(block.key.split('-')[1])
      for (const week of block.weeks) {
        for (const day of week) {
          if (day) expect(day.date.getMonth()).toBe(month)
        }
      }
    }
  })

  it('splits a boundary week across both months (masked each way)', () => {
    // May 31 2026 is a Sunday; Jun 1 is the Monday in the same column. That one
    // week column must appear in both the May and June blocks.
    const model = buildCalendarModel([], today, QUERIES, 12)
    const blocks = buildMonthBlocks(model)
    const may = blocks.find((b) => b.key === '2026-4')!
    const jun = blocks.find((b) => b.key === '2026-5')!

    const mayHasMay31 = may.weeks.some((w) =>
      w.some((d) => d?.iso === '2026-05-31')
    )
    const junHasJun1 = jun.weeks.some((w) =>
      w.some((d) => d?.iso === '2026-06-01')
    )
    expect(mayHasMay31).toBe(true)
    expect(junHasJun1).toBe(true)
    // The June block must NOT leak May 31 into its masked copy of that week.
    const junHasMay31 = jun.weeks.some((w) =>
      w.some((d) => d?.iso === '2026-05-31')
    )
    expect(junHasMay31).toBe(false)
  })

  it('preserves each day cell value from the model', () => {
    const rows: HeatmapDayRow[] = [row('2026-06-15', { query_count: 100 })]
    const model = buildCalendarModel(rows, today, QUERIES, 4)
    const jun = buildMonthBlocks(model).find((b) => b.key === '2026-5')!
    const cell = jun.weeks.flat().find((d) => d?.iso === '2026-06-15')
    expect(cell?.value).toBe(100)
  })
})

describe('pickVisibleMonthBlocks', () => {
  const today = new Date(2026, 5, 17)
  const blocks = buildMonthBlocks(buildCalendarModel([], today, QUERIES, 53))

  it('returns all blocks when width is unknown (≤ 0)', () => {
    expect(pickVisibleMonthBlocks(blocks, 0)).toHaveLength(blocks.length)
    expect(pickVisibleMonthBlocks(blocks, Number.NaN)).toHaveLength(
      blocks.length
    )
  })

  it('drops the oldest months first, always keeping the most recent', () => {
    const narrow = pickVisibleMonthBlocks(blocks, 300)
    expect(narrow.length).toBeLessThan(blocks.length)
    // The kept blocks are a trailing slice (newest months retained).
    expect(narrow.at(-1)?.key).toBe(blocks.at(-1)?.key ?? '')
  })

  it('always keeps at least the newest month even if it overflows', () => {
    const tiny = pickVisibleMonthBlocks(blocks, 1)
    expect(tiny).toHaveLength(1)
    expect(tiny[0]?.key).toBe(blocks.at(-1)?.key ?? '')
  })

  it('shows more months as width grows', () => {
    const narrow = pickVisibleMonthBlocks(blocks, 300)
    const wide = pickVisibleMonthBlocks(blocks, 1200)
    expect(wide.length).toBeGreaterThan(narrow.length)
  })
})

describe('buildStatCards', () => {
  const today = new Date(2026, 5, 17)
  const rows: HeatmapDayRow[] = [
    row('2026-06-15', {
      query_count: 100,
      failed_count: 3,
      memory_peak: 600,
      avg_duration_ms: 1800,
      written_bytes: 1024,
    }),
    row('2026-06-16', {
      query_count: 40,
      failed_count: 1,
      memory_peak: 400,
      avg_duration_ms: 900,
      written_bytes: 512,
    }),
  ]

  it('leads a sum metric with a grand total and accented peak', () => {
    const model = buildCalendarModel(rows, today, QUERIES, 4)
    const cards = buildStatCards(QUERIES, model)
    expect(cards).toHaveLength(4)
    expect(cards[0].label).toBe('Total queries')
    expect(cards[0].value).toBe('140')
    expect(cards[1].label).toBe('Busiest day')
    expect(cards[1].accent).toBe(true)
  })

  it('leads a gauge metric with the peak reading, not a meaningless sum', () => {
    const memory = METRIC_CONFIGS.memory
    const model = buildCalendarModel(rows, today, memory, 4)
    const cards = buildStatCards(memory, model)
    expect(cards[0].label).toContain('Peak')
    expect(cards[0].accent).toBe(true)
    // Peak memory = max daily reading = 600 bytes, formatted as a size.
    expect(cards[0].value).toBe('600 Bytes')
    expect(cards[1].label).toBe('Average')
  })
})

describe('resolveWindowStart', () => {
  const today = new Date(2026, 5, 17) // Jun 17 2026

  it('caps at MAX_WINDOW_MONTHS back when data spans further', () => {
    const start = resolveWindowStart([row('2020-01-05')], today)
    // 24 months inclusive of the current one → Jul 1 2024.
    expect(start.getFullYear()).toBe(2024)
    expect(start.getMonth()).toBe(6)
    expect(start.getDate()).toBe(1)
  })

  it('starts at the oldest data month when coverage is shorter', () => {
    const start = resolveWindowStart(
      [row('2026-04-20'), row('2026-05-02')],
      today
    )
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(3) // April
    expect(start.getDate()).toBe(1)
  })

  it('falls back to the full cap with no rows', () => {
    const start = resolveWindowStart([], today)
    expect(start.getFullYear()).toBe(2024)
    expect(start.getMonth()).toBe(6)
  })
})

describe('buildMonthWindowModel', () => {
  const today = new Date(2026, 5, 17)

  it('starts at a month boundary — the oldest block has no foreign days', () => {
    const model = buildMonthWindowModel([row('2026-04-10')], today, QUERIES)
    const blocks = buildMonthBlocks(model)
    expect(blocks[0]?.key).toBe('2026-3') // April, not a March remnant
    const days = blocks[0]?.weeks.flat().filter(Boolean) ?? []
    expect(days.every((d) => d?.date.getMonth() === 3)).toBe(true)
    expect(days.some((d) => d?.iso === '2026-04-01')).toBe(true)
  })

  it('runs through the end of the current month (future days dimmed)', () => {
    const model = buildMonthWindowModel([row('2026-06-01')], today, QUERIES)
    const june = buildMonthBlocks(model).find((b) => b.key === '2026-5')
    const days = june?.weeks.flat().filter(Boolean) ?? []
    expect(days.map((d) => d?.iso)).toContain('2026-06-30')
    expect(days.find((d) => d?.iso === '2026-06-30')?.isFuture).toBe(true)
  })

  it('reaches further back than a year when data allows', () => {
    const model = buildMonthWindowModel([row('2024-08-01')], today, QUERIES)
    expect(buildMonthBlocks(model).length).toBeGreaterThan(13)
  })
})

describe('summarizeVisibleBlocks', () => {
  const today = new Date(2026, 5, 17)
  const rows = [
    row('2026-04-10', { query_count: 500 }),
    row('2026-06-10', { query_count: 100 }),
    row('2026-06-11', { query_count: 40 }),
  ]
  const blocks = buildMonthBlocks(buildMonthWindowModel(rows, today, QUERIES))

  it('counts only the visible months, not the whole model', () => {
    const all = summarizeVisibleBlocks(blocks)
    const juneOnly = summarizeVisibleBlocks(blocks.slice(-1))
    expect(all.total).toBe(640)
    expect(juneOnly.total).toBe(140)
    expect(juneOnly.max).toBe(100)
    expect(juneOnly.activeDays).toBe(2)
    expect(juneOnly.totalDays).toBeLessThan(all.totalDays)
    expect(juneOnly.rangeLabel).toBe('Jun 2026 – Jun 2026')
  })

  it('excludes future days of the current month from the stats', () => {
    // Jun 1..17 inclusive — the dimmed Jun 18-30 cells never count.
    expect(summarizeVisibleBlocks(blocks.slice(-1)).totalDays).toBe(17)
  })

  it('feeds stat cards that describe the visible window', () => {
    const cards = buildStatCards(
      QUERIES,
      summarizeVisibleBlocks(blocks.slice(-1))
    )
    expect(cards[0].sub).toBe('over 17 days')
  })

  it('is empty-safe', () => {
    const empty = summarizeVisibleBlocks([])
    expect(empty.total).toBe(0)
    expect(empty.peak).toBeNull()
    expect(empty.rangeLabel).toBe('')
  })
})
