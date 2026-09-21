import {
  FEATURE_MENU,
  isExternalHref,
  NAV_CTAS,
  navHref,
  RESOURCE_DRAWER_ITEMS,
  RESOURCE_MENU,
  renderNavDrawerLinks,
  renderNavLinks,
  TOP_LEVEL_LINKS,
} from './index'
import { describe, expect, it } from 'bun:test'

describe('site-nav model', () => {
  it('keeps every feature item on a site path with an icon and description', () => {
    expect(FEATURE_MENU.length).toBe(12)
    for (const item of FEATURE_MENU) {
      expect(item.href.startsWith('/')).toBe(true)
      expect(item.icon).toBeTruthy()
      expect(item.description).toBeTruthy()
    }
  })

  it('has no duplicate hrefs across each menu', () => {
    for (const items of [FEATURE_MENU, TOP_LEVEL_LINKS, RESOURCE_MENU]) {
      const hrefs = items.map((i) => i.href)
      expect(new Set(hrefs).size).toBe(hrefs.length)
    }
  })

  it('drawer resources exclude items already top-level (Docs)', () => {
    expect(RESOURCE_DRAWER_ITEMS.map((i) => i.label)).toEqual([
      'Blog',
      'Changelog',
      'Brand',
    ])
  })

  it('resolves paths against an origin and leaves absolute URLs alone', () => {
    expect(navHref({ label: 'x', href: '/license' }, '')).toBe('/license')
    expect(
      navHref({ label: 'x', href: '/license' }, 'https://chmonitor.dev')
    ).toBe('https://chmonitor.dev/license')
    expect(
      navHref({ label: 'x', href: 'https://docs.chmonitor.dev' }, '')
    ).toBe('https://docs.chmonitor.dev')
    expect(isExternalHref('https://blog.chmonitor.dev')).toBe(true)
    expect(isExternalHref('/changelog')).toBe(false)
  })
})

describe('renderNavLinks / renderNavDrawerLinks', () => {
  const html = renderNavLinks('https://chmonitor.dev')

  it('renders both dropdowns, top-level links, badges and descriptions', () => {
    expect(html).toContain('>Features ')
    expect(html).toContain('>Resources ')
    expect(html).toContain('href="https://chmonitor.dev/features/postgres"')
    expect(html).toContain('href="https://chmonitor.dev/license"')
    expect(html).toContain(
      'href="https://docs.chmonitor.dev" target="_blank" rel="noopener"'
    )
    expect(html).toContain('nav-badge">Beta</span>')
    expect(html).toContain('<small>Release notes and product updates</small>')
    expect(html).toContain('&amp;') // descriptions escaped
    expect(html).not.toContain(' & MCP')
  })

  it('renders the drawer as a flat list without duplicate Docs', () => {
    const drawer = renderNavDrawerLinks('https://chmonitor.dev')
    expect(drawer).toContain('href="https://chmonitor.dev/cli"')
    expect(drawer.match(/docs\.chmonitor\.dev/g)?.length).toBe(1)
    expect(drawer).not.toContain('nav-group')
  })

  it('keeps CTA targets stable', () => {
    expect(NAV_CTAS.github.href).toBe('https://github.com/chmonitor/chmonitor')
    expect(NAV_CTAS.dashboard.href).toBe('https://dash.chmonitor.dev')
  })
})
