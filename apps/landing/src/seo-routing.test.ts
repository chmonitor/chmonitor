import {
  DASHBOARD_PREFIXES,
  landingRedirectUrl,
  shouldNoindexHost,
  stripTrailingSlash,
} from './seo-routing'
import { describe, expect, test } from 'bun:test'

describe('landing SEO routing', () => {
  test('explorer and table query URLs 301 to the dashboard', () => {
    const explorer = landingRedirectUrl(
      new URL(
        'https://chmonitor.dev/explorer?host=0&database=system&table=tables'
      )
    )
    expect(explorer).toBe(
      'https://dash.chmonitor.dev/explorer?host=0&database=system&table=tables'
    )
    expect(
      landingRedirectUrl(
        new URL(
          'https://chmonitor.dev/table?host=0&database=system&table=trace_log'
        )
      )
    ).toBe(
      'https://dash.chmonitor.dev/table?host=0&database=system&table=trace_log'
    )
  })

  test('trailing slash on a marketing page canonicalizes on-origin', () => {
    expect(landingRedirectUrl(new URL('https://chmonitor.dev/pricing/'))).toBe(
      'https://chmonitor.dev/pricing'
    )
  })

  test('does not redirect real marketing paths', () => {
    expect(landingRedirectUrl(new URL('https://chmonitor.dev/'))).toBeNull()
    expect(
      landingRedirectUrl(new URL('https://chmonitor.dev/pricing'))
    ).toBeNull()
    expect(
      landingRedirectUrl(new URL('https://chmonitor.dev/features/storage'))
    ).toBeNull()
    expect(
      landingRedirectUrl(new URL('https://chmonitor.dev/install.sh'))
    ).toBeNull()
    expect(
      landingRedirectUrl(new URL('https://chmonitor.dev/watch/v0.3'))
    ).toBeNull()
  })

  test('legacy /docs goes to the docs host', () => {
    expect(
      landingRedirectUrl(
        new URL('https://chmonitor.dev/docs/guide/getting-started')
      )
    ).toBe('https://docs.chmonitor.dev/guide/getting-started')
  })

  test('covers explorer and table prefixes', () => {
    expect(DASHBOARD_PREFIXES.has('explorer')).toBe(true)
    expect(DASHBOARD_PREFIXES.has('table')).toBe(true)
    expect(DASHBOARD_PREFIXES.has('pricing')).toBe(false)
  })

  test('preview hosts are noindexed', () => {
    expect(shouldNoindexHost('preview.chmonitor.dev')).toBe(true)
    expect(shouldNoindexHost('chmonitor.dev')).toBe(false)
    expect(stripTrailingSlash('/guide/')).toBe('/guide')
  })
})
