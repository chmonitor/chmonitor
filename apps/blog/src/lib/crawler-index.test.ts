import type { CollectionEntry } from 'astro:content'

import { buildLlmsTxt, buildSitemapXml } from './crawler-index'
import { describe, expect, test } from 'bun:test'

function post(
  id: string,
  data: Partial<CollectionEntry<'blog'>['data']> & { title: string }
): CollectionEntry<'blog'> {
  return {
    id,
    collection: 'blog',
    data: {
      description: data.description ?? 'desc',
      date: data.date ?? new Date('2026-01-01'),
      tag: data.tag ?? 'Release',
      draft: data.draft ?? false,
      version: data.version,
      title: data.title,
    },
  } as CollectionEntry<'blog'>
}

describe('blog crawler index', () => {
  const posts = [
    post('v0.3', {
      title: 'v0.3',
      version: 'v0.3',
      tag: 'Release',
      date: new Date('2026-01-02'),
    }),
    post('too-many-parts', {
      title: 'Too many parts',
      tag: '5 min of ClickHouse',
      date: new Date('2026-01-01'),
    }),
    post('future', {
      title: 'Future',
      date: new Date('2099-01-01'),
    }),
  ]

  test('sitemap lists home, published posts, and categories — not future posts', () => {
    const xml = buildSitemapXml(posts)
    expect(xml).toContain('https://blog.chmonitor.dev/')
    expect(xml).toContain('https://blog.chmonitor.dev/v0.3/')
    expect(xml).toContain('https://blog.chmonitor.dev/watch/v0-3/')
    expect(xml).toContain('https://blog.chmonitor.dev/too-many-parts/')
    expect(xml).toContain(
      'https://blog.chmonitor.dev/category/5-min-of-clickhouse/'
    )
    expect(xml).not.toContain('/future/')
  })

  test('llms.txt lists every published post and sister sites', () => {
    const txt = buildLlmsTxt(posts)
    expect(txt).toContain('# chmonitor blog')
    expect(txt).toContain('[v0.3]')
    expect(txt).toContain('## Categories')
    expect(txt).toContain('https://docs.chmonitor.dev/llms.txt')
    expect(txt).not.toContain('[Future]')
  })
})
