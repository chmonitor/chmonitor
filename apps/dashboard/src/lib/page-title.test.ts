import { OG_PAGES } from './og'
import { getPageTitle, pageTitlesForHref, ROUTE_TITLE_MAP } from './page-title'
import { describe, expect, test } from 'bun:test'

describe('getPageTitle', () => {
  test('uses the explicit map when present', () => {
    expect(getPageTitle('/overview')).toBe('Overview')
    expect(getPageTitle('/explorer')).toBe('Database Explorer')
    expect(getPageTitle('/ttl-partition-health')).toBe('TTL & Partition Health')
    expect(getPageTitle('/schema-diff')).toBe('Schema Compare')
    expect(getPageTitle('/settings-diff')).toBe('Settings Diff')
    expect(getPageTitle('/advisor')).toBe('Advisor')
  })

  test('does not treat /tables or /query-cache as detail routes', () => {
    expect(getPageTitle('/tables')).toBe('Tables')
    expect(getPageTitle('/tables-overview')).toBe('Tables Overview')
    expect(getPageTitle('/query-cache')).toBe('Query Cache')
  })

  test('query and table detail routes keep their special titles', () => {
    expect(getPageTitle('/query', new URLSearchParams())).toBe('Query Details')
    expect(
      getPageTitle('/query', new URLSearchParams('query_id=abcdef0123456789'))
    ).toBe('Query Details (abcdef01)')
    expect(getPageTitle('/table', new URLSearchParams())).toBe('Table Details')
    expect(
      getPageTitle(
        '/table',
        new URLSearchParams('database=system&table=query_log')
      )
    ).toBe('Table Details (system.query_log)')
  })

  test('falls back to OG headTitle/title when the map has no entry', () => {
    // fleet is in OG_PAGES but not ROUTE_TITLE_MAP
    expect(ROUTE_TITLE_MAP['/fleet']).toBeUndefined()
    expect(getPageTitle('/fleet')).toBe(
      OG_PAGES.fleet.headTitle ?? OG_PAGES.fleet.title
    )
  })
})

describe('pageTitlesForHref', () => {
  test('includes the tab title and a differing OG headline', () => {
    const titles = pageTitlesForHref('/schema-diff')
    expect(titles).toContain('Schema Compare')
    expect(titles).toContain('Cross-Host Schema Compare')
  })

  test('TTL inventory is searchable as the page title', () => {
    expect(pageTitlesForHref('/ttl-partition-health')).toContain(
      'TTL & Partition Health'
    )
  })

  test('dedupes when map and OG agree', () => {
    const titles = pageTitlesForHref('/settings-diff')
    expect(titles.filter((t) => t === 'Settings Diff')).toHaveLength(1)
  })
})
