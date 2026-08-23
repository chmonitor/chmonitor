import { FEATURE_PAGES } from '../data/feature-pages'
import { allLandingPages, buildLlmsTxt, buildSitemapXml } from './site-urls'
import { describe, expect, test } from 'bun:test'

describe('landing crawler index', () => {
  test('lists every static page and feature slug', () => {
    const pages = allLandingPages()
    const paths = pages.map((p) => p.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/pricing')
    expect(paths).toContain('/vs-datadog')
    expect(paths).toContain('/clickhouse-vs-druid-pinot')
    for (const feature of FEATURE_PAGES) {
      expect(paths).toContain(`/features/${feature.slug}`)
    }
    expect(new Set(paths).size).toBe(paths.length)
  })

  test('sitemap.xml is a urlset of every loc', () => {
    const xml = buildSitemapXml()
    expect(xml).toContain('https://chmonitor.dev/features/ai-agent')
    expect(xml.startsWith('<?xml')).toBe(true)
    expect(xml).toContain('</urlset>')
  })

  test('llms.txt lists every page, sister sites, and published blog posts', () => {
    const txt = buildLlmsTxt()
    expect(txt).toContain('# chmonitor')
    expect(txt).toContain('https://docs.chmonitor.dev/llms.txt')
    expect(txt).toContain('https://blog.chmonitor.dev/llms.txt')
    expect(txt).toContain('https://blog.chmonitor.dev/sitemap.xml')
    expect(txt).toContain('/features/postgres')
    expect(txt).toContain('https://blog.chmonitor.dev/')
  })
})
