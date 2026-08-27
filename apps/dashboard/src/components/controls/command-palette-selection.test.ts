import type { MenuItem } from '@/components/menu/types'

import {
  activatePaletteRow,
  buildSectionedPaletteRows,
  filterPaletteRows,
  navigablePaletteRows,
  paletteItemId,
  stepPaletteIndex,
} from './command-palette-selection'
import { menuItemPaletteValue } from './command-palette-utils'
import { describe, expect, test } from 'bun:test'

function page(title: string, href: string, description?: string): MenuItem {
  return { title, href, description }
}

const tablesGroup: MenuItem = {
  title: 'Tables',
  href: '/tables',
  items: [
    page('Tables Overview', '/tables-overview', 'Table storage statistics'),
    page(
      'Table Replicas',
      '/replicas',
      'Replicated table health status and lag metrics'
    ),
    page(
      'Replication Queue',
      '/replication-queue',
      'Pending and in-progress replication tasks'
    ),
    page(
      'Replicated Fetches',
      '/replicated-fetches',
      'Currently executing background part downloads from replica sources'
    ),
  ],
}

describe('filterPaletteRows + selectedIndex + Enter', () => {
  test('Enter opens the highlighted href when a Hidden badge and group header sit above items', () => {
    const hiddenHrefs = new Set([
      '/replicas',
      '/replicated-fetches',
      '/replication-queue',
    ])
    const rows = buildSectionedPaletteRows([tablesGroup], hiddenHrefs)
    const filtered = filterPaletteRows(rows, 'table replicas')
    const navigable = navigablePaletteRows(filtered)

    expect(filtered[0]).toMatchObject({ kind: 'header', title: 'Tables' })
    expect(navigable[0]?.title).toBe('Table Replicas')
    expect(navigable[0]?.hidden).toBe(true)
    expect(navigable[0]?.href).toBe('/replicas')

    // Naive index into the flattened list hits the header (the #3346
    // off-by-one). Activation must skip it and use navigable[selectedIndex].
    expect(filtered[0]?.kind).toBe('header')
    expect(activatePaletteRow(filtered, 0)?.href).toBe('/replicas')
    expect(activatePaletteRow(filtered, 0)?.href).not.toBe(
      '/replicated-fetches'
    )
  })

  test('arrow-down then Enter still matches the highlight', () => {
    const rows = buildSectionedPaletteRows([tablesGroup])
    const filtered = filterPaletteRows(rows, 'table replicas')
    const navigable = navigablePaletteRows(filtered)
    expect(navigable.length).toBeGreaterThan(1)

    const selectedIndex = stepPaletteIndex(0, 1, navigable.length)
    expect(activatePaletteRow(filtered, selectedIndex)?.href).toBe(
      navigable[selectedIndex]?.href
    )
    expect(activatePaletteRow(filtered, selectedIndex)?.href).not.toBe(
      navigable[0]?.href
    )
  })

  test('Hidden is a badge on the item, not an extra selectedIndex slot', () => {
    const visible = buildSectionedPaletteRows([tablesGroup])
    const hidden = buildSectionedPaletteRows(
      [tablesGroup],
      new Set(['/replicas', '/replicated-fetches'])
    )
    const query = 'table replicas'
    const visibleNav = navigablePaletteRows(filterPaletteRows(visible, query))
    const hiddenNav = navigablePaletteRows(filterPaletteRows(hidden, query))

    expect(hiddenNav.map((row) => row.href)).toEqual(
      visibleNav.map((row) => row.href)
    )
    expect(hiddenNav[0]?.hidden).toBe(true)
    expect(activatePaletteRow(filterPaletteRows(hidden, query), 0)?.href).toBe(
      activatePaletteRow(filterPaletteRows(visible, query), 0)?.href
    )
  })

  test('cmdk item identity is group+href, not the search haystack', () => {
    const haystack = menuItemPaletteValue(
      page(
        'Table Replicas',
        '/replicas',
        'Replicated table health status and lag metrics'
      ),
      'Tables'
    )
    expect(paletteItemId('Tables', '/replicas')).toBe('page:Tables:/replicas')
    expect(paletteItemId('Tables', '/replicas')).not.toBe(haystack)
    expect(paletteItemId('Tables', '/replicas')).not.toBe(
      paletteItemId('Tables', '/replicated-fetches')
    )
  })
})
