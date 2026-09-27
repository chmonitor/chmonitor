import type { MenuItem } from '@/components/menu/types'

import {
  filterUnavailableVisibility,
  hidesWhenUnavailable,
  resolveUnavailable,
  type UnavailableState,
  unavailableReasonText,
} from './unavailable-visibility'
import { describe, expect, it } from 'bun:test'

/** A settled host: nothing loading, user on the default Hide setting. */
function settled(overrides: Partial<UnavailableState> = {}): UnavailableState {
  return {
    tableAvailable: true,
    metadataDbSatisfied: true,
    availabilityLoading: false,
    dimUnavailablePages: false,
    ...overrides,
  }
}

const tableCheckItem = { tableCheck: 'system.query_log' }
const metadataDbItem = { requiresMetadataDb: true }

describe('hidesWhenUnavailable', () => {
  it('treats a tableCheck item as structurally impossible → hide', () => {
    expect(hidesWhenUnavailable(tableCheckItem)).toBe(true)
    expect(hidesWhenUnavailable({ tableCheck: ['a', 'b'] })).toBe(true)
  })

  it('treats a config-gated item as enableable → dim', () => {
    expect(hidesWhenUnavailable(metadataDbItem)).toBe(false)
    expect(hidesWhenUnavailable({})).toBe(false)
  })

  it('lets the per-item flag override the class in both directions', () => {
    expect(
      hidesWhenUnavailable({ ...metadataDbItem, hideWhenUnavailable: true })
    ).toBe(true)
    expect(
      hidesWhenUnavailable({ ...tableCheckItem, hideWhenUnavailable: false })
    ).toBe(false)
  })
})

describe('resolveUnavailable', () => {
  it('reports available when every signal passes', () => {
    const resolution = resolveUnavailable(tableCheckItem, settled())
    expect(resolution).toEqual({
      visibility: 'available',
      tableAvailable: true,
      metadataDbSatisfied: true,
    })
  })

  it('hides a tableCheck page whose backing table is missing (default)', () => {
    expect(
      resolveUnavailable(tableCheckItem, settled({ tableAvailable: false }))
        .visibility
    ).toBe('hidden')
  })

  it('dims a config-gated page with no metadata DB (default)', () => {
    const resolution = resolveUnavailable(
      metadataDbItem,
      settled({ metadataDbSatisfied: false })
    )
    expect(resolution.visibility).toBe('dimmed')
  })

  it('hides a config-gated page that opts in', () => {
    expect(
      resolveUnavailable(
        { ...metadataDbItem, hideWhenUnavailable: true },
        settled({ metadataDbSatisfied: false })
      ).visibility
    ).toBe('hidden')
  })

  it('dims a tableCheck page that opts out of hiding', () => {
    expect(
      resolveUnavailable(
        { ...tableCheckItem, hideWhenUnavailable: false },
        settled({ tableAvailable: false })
      ).visibility
    ).toBe('dimmed')
  })

  it('dims everything when the user picked Dim, whatever the class', () => {
    const state = settled({ dimUnavailablePages: true })
    expect(
      resolveUnavailable(tableCheckItem, { ...state, tableAvailable: false })
        .visibility
    ).toBe('dimmed')
    expect(
      resolveUnavailable(metadataDbItem, {
        ...state,
        metadataDbSatisfied: false,
      }).visibility
    ).toBe('dimmed')
  })

  it('never hides from an unsettled availability map', () => {
    expect(
      resolveUnavailable(
        tableCheckItem,
        settled({ tableAvailable: false, availabilityLoading: true })
      ).visibility
    ).toBe('available')
  })

  it('carries the signals behind the verdict so the UI can explain itself', () => {
    expect(
      resolveUnavailable(
        tableCheckItem,
        settled({ tableAvailable: false, metadataDbSatisfied: false })
      )
    ).toEqual({
      visibility: 'hidden',
      tableAvailable: false,
      metadataDbSatisfied: false,
    })
  })
})

describe('unavailableReasonText', () => {
  it('is null on an available row', () => {
    expect(unavailableReasonText(resolveUnavailable({}, settled()))).toBeNull()
  })

  it('names the missing system table', () => {
    expect(
      unavailableReasonText(
        resolveUnavailable(tableCheckItem, settled({ tableAvailable: false }))
      )
    ).toBe('System table not found on this host')
  })

  it('names the missing metadata database', () => {
    expect(
      unavailableReasonText(
        resolveUnavailable(
          metadataDbItem,
          settled({ metadataDbSatisfied: false })
        )
      )
    ).toBe('Requires a metadata database — configure D1 or Postgres')
  })
})

describe('filterUnavailableVisibility', () => {
  const group: MenuItem = {
    title: 'Insights',
    href: '',
    items: [
      { title: 'Insights', href: '/insights' },
      { title: 'Traffic', href: '/traffic', tableCheck: 'system.query_log' },
      { title: 'Insights Settings', href: '/insights-settings' },
    ],
  }

  const noQueryLog = (item: MenuItem) =>
    item.tableCheck ? 'hidden' : 'available'

  it('drops the hidden leaf and keeps its siblings', () => {
    const result = filterUnavailableVisibility([group], noQueryLog)
    expect(result[0].items?.map((child) => child.href)).toEqual([
      '/insights',
      '/insights-settings',
    ])
  })

  it('drops a parent left empty by the removal — no dangling chevron', () => {
    const allTableCheck: MenuItem = {
      title: 'Keeper',
      href: '',
      items: [
        { title: 'Info', href: '/keeper', tableCheck: 'system.zookeeper_info' },
        {
          title: 'Log',
          href: '/keeper-log',
          tableCheck: 'system.zookeeper_log',
        },
      ],
    }
    expect(filterUnavailableVisibility([allTableCheck], noQueryLog)).toEqual([])
  })

  it('keeps a dimmed child — the parent still has a body', () => {
    const dimmed: MenuItem = {
      title: 'Insights',
      href: '',
      items: [
        { title: 'Insights', href: '/insights' },
        {
          title: 'Reports',
          href: '/report-settings',
          requiresMetadataDb: true,
        },
      ],
    }
    const result = filterUnavailableVisibility([dimmed], (item) =>
      item.requiresMetadataDb ? 'dimmed' : 'available'
    )
    expect(result[0].items?.map((child) => child.href)).toEqual([
      '/insights',
      '/report-settings',
    ])
  })
})
