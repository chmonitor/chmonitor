/**
 * Catalog-wide sanity checks for DECLARATIVE_CHART_CATALOG
 * (plans/58-declarative-chart-schema.md). Per-domain parity tests
 * (query/query-catalog.test.ts, system/system-catalog.test.ts, …) prove each
 * entry round-trips to its hand-authored factory config — but that comparison
 * is against a *transcription* of the original factory call (the hand-authored
 * chart files export only a rendered FC, not their config object, so there is
 * no live reference to import and diff against; touching those files to
 * export the config would violate the "additive only" constraint). The
 * "resolves in the real chart-registry" test below is the one check here that
 * verifies against a live source of truth rather than a transcription: it
 * mirrors the orphan guard in
 * `lib/query-config/declarative/catalog/flip-safety.test.ts`, catching a
 * typo'd `chartName` that would otherwise 404 silently at
 * `GET /api/v1/charts/$chartName` instead of failing a test.
 */

import { loadDeclarativeChart } from '../loader'
import { DECLARATIVE_CHART_CATALOG } from './index'
import { describe, expect, test } from 'bun:test'
import { hasChart } from '@/lib/api/chart-registry'

describe('DECLARATIVE_CHART_CATALOG', () => {
  test('has at least 5 ported charts', () => {
    expect(
      Object.keys(DECLARATIVE_CHART_CATALOG).length
    ).toBeGreaterThanOrEqual(5)
  })

  test('every entry is keyed by its own chartName', () => {
    for (const [key, chart] of Object.entries(DECLARATIVE_CHART_CATALOG)) {
      expect(chart.chartName).toBe(key)
    }
  })

  test('every entry loads without error', () => {
    for (const chart of Object.values(DECLARATIVE_CHART_CATALOG)) {
      expect(() => loadDeclarativeChart(chart)).not.toThrow()
    }
  })

  test('includes at least one area chart and one bar chart', () => {
    const kinds = new Set(
      Object.values(DECLARATIVE_CHART_CATALOG).map((c) => c.type)
    )
    expect(kinds.has('area')).toBe(true)
    expect(kinds.has('bar')).toBe(true)
  })

  // Orphan guard: every chartName must resolve in the real, server-side
  // chart-registry (lib/api/chart-registry.ts) — the declarative catalog
  // describes presentation for a chart whose SQL is already registered there.
  // A typo here would otherwise 404 silently at runtime instead of failing here.
  test('every chartName resolves in the live chart-registry', () => {
    for (const chartName of Object.keys(DECLARATIVE_CHART_CATALOG)) {
      expect(hasChart(chartName)).toBe(true)
    }
  })
})
