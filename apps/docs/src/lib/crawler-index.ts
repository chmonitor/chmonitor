import { siteUrl } from './shared'

export type CrawlerPage = {
  url: string
  title?: string
  description?: string
}

export function absoluteDocUrl(pageUrl: string, origin = siteUrl): string {
  if (pageUrl.startsWith('http')) return pageUrl
  const path = pageUrl === '/' ? '' : pageUrl
  return `${origin}${path}`
}

export function markdownUrl(pageUrl: string, origin = siteUrl): string {
  const path = pageUrl === '/' || pageUrl === '' ? '/index.md' : `${pageUrl}.md`
  return `${origin}${path}`
}

export function sectionOf(pageUrl: string): string {
  const first = pageUrl.replace(/^\//, '').split('/')[0]
  if (first === 'guide' || first === '') return 'Guide'
  if (first === 'operate') return 'Deploy & operate'
  if (first === 'reference') return 'Reference'
  return 'Docs'
}

export function buildSitemapXml(
  pages: CrawlerPage[],
  origin = siteUrl
): string {
  const locs = new Set<string>()
  locs.add(origin)
  for (const page of pages) {
    locs.add(absoluteDocUrl(page.url, origin))
  }
  const urls = [...locs].sort()
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n')}
</urlset>
`
}

export function buildLlmsTxt(pages: CrawlerPage[], origin = siteUrl): string {
  const sorted = [...pages].sort((a, b) => a.url.localeCompare(b.url))
  const groups = new Map<string, CrawlerPage[]>()
  for (const page of sorted) {
    const section = sectionOf(page.url)
    const list = groups.get(section) ?? []
    list.push(page)
    groups.set(section, list)
  }

  const lines = [
    '# chmonitor documentation',
    '',
    '> Read-only ClickHouse monitoring dashboard with an AI agent and MCP server. Deploy on Docker, Kubernetes, or Cloudflare Workers.',
    '',
    `Full concatenated markdown: ${origin}/llms-full.txt`,
    `HTML sitemap: ${origin}/sitemap.xml`,
    '',
    'Each page is also available as markdown by appending `.md` (example: `/guide/getting-started.md`).',
    '',
  ]

  for (const section of ['Guide', 'Deploy & operate', 'Reference', 'Docs']) {
    const list = groups.get(section)
    if (!list?.length) continue
    lines.push(`## ${section}`, '')
    for (const page of list) {
      const href = absoluteDocUrl(page.url, origin)
      const title = page.title?.trim() || href
      const desc = page.description?.trim()
      lines.push(
        desc ? `- [${title}](${href}): ${desc}` : `- [${title}](${href})`
      )
      lines.push(`  - markdown: ${markdownUrl(page.url, origin)}`)
    }
    lines.push('')
  }

  lines.push(
    '## Other chmonitor sites',
    '',
    '- [Marketing site](https://chmonitor.dev/llms.txt)',
    '- [Blog](https://blog.chmonitor.dev/llms.txt)',
    '- [Hosted dashboard](https://dash.chmonitor.dev)',
    ''
  )

  return lines.join('\n')
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
