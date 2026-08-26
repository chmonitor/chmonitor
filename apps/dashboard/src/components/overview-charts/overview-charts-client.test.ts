/**
 * Overview metric cards must wrap before they crush: 1-col on phones, 2×2 from
 * sm, four-across only from xl. `md:grid-cols-4` is 768px; `lg:grid-cols-4` is
 * 1024px with a docked sidebar (~768px content) — both crush /overview (#3296).
 */

import { OVERVIEW_KPI_GRID_CLASS } from './overview-charts-client'
import { describe, expect, test } from 'bun:test'

describe('OVERVIEW_KPI_GRID_CLASS', () => {
  test('is 1-col, 2-col from sm, 4-col from xl — never 4-across at md or lg', () => {
    const tokens = OVERVIEW_KPI_GRID_CLASS.split(/\s+/)

    expect(tokens).toContain('grid-cols-1')
    expect(tokens).toContain('sm:grid-cols-2')
    expect(tokens).toContain('xl:grid-cols-4')
    expect(tokens).not.toContain('grid-cols-2')
    expect(tokens).not.toContain('grid-cols-4')
    expect(OVERVIEW_KPI_GRID_CLASS).not.toContain('md:grid-cols-4')
    expect(OVERVIEW_KPI_GRID_CLASS).not.toContain('lg:grid-cols-4')
  })
})
