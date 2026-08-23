import type { CollectionEntry } from 'astro:content'

import { isPublished } from './published'
import { postSlug, tagSlug } from './slug'

const ORIGIN = 'https://blog.chmonitor.dev'

export function publishedPosts(posts: CollectionEntry<'blog'>[]) {
  return posts
    .filter((p) => isPublished(p.data))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
}

export function categoryPaths(posts: CollectionEntry<'blog'>[]): string[] {
  const tags = [...new Set(publishedPosts(posts).map((p) => p.data.tag))]
  return tags.map((tag) => `/category/${tagSlug(tag)}/`)
}

export function buildSitemapXml(
  posts: CollectionEntry<'blog'>[],
  origin = ORIGIN
): string {
  const locs = [
    `${origin}/`,
    `${origin}/watch/v0.3/`,
    ...publishedPosts(posts).map((p) => `${origin}/${postSlug(p)}/`),
    ...categoryPaths(posts).map((path) => `${origin}${path}`),
  ]
  const unique = [...new Set(locs)]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${unique.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n')}
</urlset>
`
}

export function buildLlmsTxt(
  posts: CollectionEntry<'blog'>[],
  origin = ORIGIN
): string {
  const published = publishedPosts(posts)
  const categories = [...new Set(published.map((p) => p.data.tag))].sort(
    (a, b) => a.localeCompare(b)
  )

  const lines = [
    '# chmonitor blog',
    '',
    'Release notes, product updates, how-to guides, and ClickHouse diagnostic deep-dives from the team building the open-source ClickHouse monitoring dashboard.',
    '',
    `> Latest: ${published[0]?.data.title ?? 'n/a'}`,
    '',
    `HTML sitemap: ${origin}/sitemap.xml`,
    '',
    '## Watch',
    '',
    `- [chmonitor v0.3 launch film](${origin}/watch/v0.3/): 28-second launch film for the v0.3 rebuild.`,
    '',
    '## Posts',
    '',
    ...published.map((post) => {
      const url = `${origin}/${postSlug(post)}/`
      return `- [${post.data.title}](${url}): ${post.data.description}`
    }),
    '',
    '## Categories',
    '',
    ...categories.map(
      (tag) => `- [${tag}](${origin}/category/${tagSlug(tag)}/)`
    ),
    '',
    '## Other chmonitor sites',
    '',
    '- [Marketing](https://chmonitor.dev/llms.txt)',
    '- [Docs](https://docs.chmonitor.dev/llms.txt)',
    '- [Hosted dashboard](https://dash.chmonitor.dev)',
    '',
  ]
  return lines.join('\n')
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
