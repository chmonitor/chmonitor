import {
  absoluteDocUrl,
  buildLlmsTxt,
  buildSitemapXml,
  markdownUrl,
  sectionOf,
} from './crawler-index'
import { describe, expect, test } from 'bun:test'

const pages = [
  {
    url: '/',
    title: 'Introduction',
    description: 'What chmonitor is.',
  },
  {
    url: '/guide/guides/clickhouse-grant-syntax',
    title: 'GRANT syntax',
    description: 'CREATE vs CREATE TABLE.',
  },
  {
    url: '/operate/deploy/docker',
    title: 'Docker',
    description: 'Compose deploy.',
  },
  {
    url: '/reference/faq',
    title: 'FAQ',
  },
]

describe('crawler-index', () => {
  test('sitemap lists origin and every HTML page', () => {
    const xml = buildSitemapXml(pages)
    expect(xml).toContain('<loc>https://docs.chmonitor.dev</loc>')
    expect(xml).toContain(
      '<loc>https://docs.chmonitor.dev/guide/guides/clickhouse-grant-syntax</loc>'
    )
    expect(xml).not.toContain('.md</loc>')
  })

  test('llms.txt lists every page plus markdown twin', () => {
    const txt = buildLlmsTxt(pages)
    expect(txt).toContain('# chmonitor documentation')
    expect(txt).toContain('## Guide')
    expect(txt).toContain('## Deploy & operate')
    expect(txt).toContain('## Reference')
    expect(txt).toContain('clickhouse-grant-syntax.md')
    expect(txt).toContain('https://docs.chmonitor.dev/index.md')
    expect(txt).toContain('https://chmonitor.dev/llms.txt')
  })

  test('url helpers', () => {
    expect(absoluteDocUrl('/guide')).toBe('https://docs.chmonitor.dev/guide')
    expect(markdownUrl('/')).toBe('https://docs.chmonitor.dev/index.md')
    expect(sectionOf('/operate/deploy')).toBe('Deploy & operate')
    expect(sectionOf('/')).toBe('Guide')
  })
})
