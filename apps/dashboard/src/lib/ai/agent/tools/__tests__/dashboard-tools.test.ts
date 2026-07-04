import {
  buildDashboardSuggestion,
  createDashboardTools,
  isKnownChart,
} from '../dashboard-tools'
import { describe, expect, test } from 'bun:test'
import { isValidWidget, widgetsCollide } from '@/types/dashboard-layout'

describe('suggest_dashboard', () => {
  test('exposes the suggest_dashboard tool', () => {
    const tools = createDashboardTools() as any
    expect(tools.suggest_dashboard).toBeDefined()
  })

  test('a replication request yields replication-related registry charts', () => {
    const result = buildDashboardSuggestion(
      'show me everything about replication health'
    )
    expect(result.type).toBe('dashboard_suggestion')
    expect(result.chartCount).toBeGreaterThan(0)
    const chartNames = result.layout.widgets.map((w) => w.chartName)
    expect(chartNames.some((name) => name?.includes('replication'))).toBe(true)
  })

  test('a merge request yields merge-related registry charts', () => {
    const result = buildDashboardSuggestion('merge backlog and mutations')
    const chartNames = result.layout.widgets.map((w) => w.chartName)
    expect(chartNames.some((name) => name?.includes('merge'))).toBe(true)
  })

  test('never emits a chart name outside the registry', () => {
    const requests = [
      'replication health',
      'memory and cpu pressure',
      'asdkjhasd nonsense gibberish query',
      '',
      'zookeeper keeper cluster status',
    ]
    for (const request of requests) {
      const result = buildDashboardSuggestion(request || 'overview')
      for (const widget of result.layout.widgets) {
        expect(widget.chartName).toBeDefined()
        expect(isKnownChart(widget.chartName as string)).toBe(true)
      }
    }
  })

  test('a vague/unmatched request still yields a non-empty fallback dashboard', () => {
    const result = buildDashboardSuggestion('asdkjhasd nonsense gibberish')
    expect(result.chartCount).toBeGreaterThan(0)
  })

  test('every widget is a valid DashboardWidget per the plan-57 contract', () => {
    const result = buildDashboardSuggestion('replication and merge health')
    for (const widget of result.layout.widgets) {
      expect(isValidWidget(widget)).toBe(true)
    }
  })

  test('widgets never collide with each other', () => {
    const result = buildDashboardSuggestion(
      'replication merges memory disk cpu queries',
      { maxWidgets: 10 }
    )
    for (const widget of result.layout.widgets) {
      expect(widgetsCollide(widget, result.layout.widgets)).toBe(false)
    }
  })

  test('respects maxWidgets bound', () => {
    const result = buildDashboardSuggestion('query performance', {
      maxWidgets: 3,
    })
    expect(result.chartCount).toBeLessThanOrEqual(3)
  })

  test('clamps maxWidgets to the documented range', () => {
    const tooMany = buildDashboardSuggestion('query performance', {
      maxWidgets: 999,
    })
    expect(tooMany.chartCount).toBeLessThanOrEqual(10)

    const tooFew = buildDashboardSuggestion('query performance', {
      maxWidgets: 0,
    })
    expect(tooFew.chartCount).toBeGreaterThanOrEqual(1)
  })

  test('uses the request text as the default dashboard name', () => {
    const result = buildDashboardSuggestion('replication health overview')
    expect(result.name).toContain('replication health overview')
  })

  test('honors an explicit name override', () => {
    const result = buildDashboardSuggestion('replication health', {
      name: 'My Replication Board',
    })
    expect(result.name).toBe('My Replication Board')
  })

  test('the suggest_dashboard tool execute() matches the pure builder', async () => {
    const tools = createDashboardTools() as any
    const result = await tools.suggest_dashboard.execute({
      request: 'replication health',
    })
    expect(result.type).toBe('dashboard_suggestion')
    expect(result.chartCount).toBeGreaterThan(0)
    for (const widget of result.layout.widgets) {
      expect(isKnownChart(widget.chartName)).toBe(true)
    }
  })
})
