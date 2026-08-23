import { FEATURE_PAGES } from '../data/feature-pages'
import { getPublishedBlogPosts } from './latest-blog-post'

export type ListedPage = {
  path: string
  title: string
  description: string
}

const ORIGIN = 'https://chmonitor.dev'

/** Static marketing routes (not 404). Feature slugs come from FEATURE_PAGES. */
export const STATIC_PAGES: ListedPage[] = [
  {
    path: '/',
    title: 'chmonitor',
    description:
      'Open-source ClickHouse monitoring dashboard with an AI agent.',
  },
  {
    path: '/pricing',
    title: 'Pricing',
    description: 'Self-hosted licenses and hosted cloud pricing.',
  },
  {
    path: '/changelog',
    title: 'Changelog',
    description: 'What shipped in each chmonitor release.',
  },
  {
    path: '/cli',
    title: 'CLI',
    description: 'chm / chmonitor terminal client.',
  },
  {
    path: '/watch/v0.3',
    title: 'chmonitor v0.3 launch film',
    description:
      '36-second walkthrough of the v0.3 dashboard, AI agent, and cluster health.',
  },
  {
    path: '/customers',
    title: 'Customers',
    description: 'Who runs ClickHouse with chmonitor.',
  },
  {
    path: '/brand',
    title: 'Brand',
    description: 'Logos and brand assets.',
  },
  {
    path: '/performance',
    title: 'Performance',
    description: 'How chmonitor stays fast on large clusters.',
  },
  {
    path: '/cluster-health',
    title: 'Cluster health',
    description: 'Replication, merges, and node health views.',
  },
  {
    path: '/monitor-queries',
    title: 'Monitor queries',
    description: 'Running, slow, and failed ClickHouse queries.',
  },
  {
    path: '/replication',
    title: 'Replication',
    description: 'Replication lag and replica health.',
  },
  {
    path: '/vs-datadog',
    title: 'chmonitor vs Datadog',
    description: 'ClickHouse-native monitoring compared to Datadog.',
  },
  {
    path: '/vs-grafana',
    title: 'chmonitor vs Grafana',
    description: 'Dedicated ClickHouse ops UI vs Grafana panels.',
  },
  {
    path: '/vs-clickhouse-cloud',
    title: 'chmonitor vs ClickHouse Cloud console',
    description: 'Monitoring your own clusters vs the Cloud console.',
  },
  {
    path: '/clickhouse-vs-postgres',
    title: 'ClickHouse vs Postgres',
    description: 'When analytics belongs in ClickHouse.',
  },
  {
    path: '/clickhouse-vs-timescaledb',
    title: 'ClickHouse vs TimescaleDB',
    description: 'OLAP vs time-series Postgres.',
  },
  {
    path: '/clickhouse-vs-druid-pinot',
    title: 'ClickHouse vs Druid vs Pinot',
    description: 'Real-time OLAP engine comparison.',
  },
  {
    path: '/license/lookup',
    title: 'License lookup',
    description: 'Look up a self-hosted license key.',
  },
  {
    path: '/license/register',
    title: 'Register license',
    description: 'Register a self-hosted license.',
  },
]

export function allLandingPages(): ListedPage[] {
  const features: ListedPage[] = FEATURE_PAGES.map((p) => ({
    path: `/features/${p.slug}`,
    title: p.h1,
    description: p.description,
  }))
  const seen = new Set<string>()
  const out: ListedPage[] = []
  for (const page of [...STATIC_PAGES, ...features]) {
    if (seen.has(page.path)) continue
    seen.add(page.path)
    out.push(page)
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export function absoluteUrl(path: string, origin = ORIGIN): string {
  if (path === '/') return origin
  return `${origin}${path}`
}

export function buildSitemapXml(
  pages = allLandingPages(),
  origin = ORIGIN
): string {
  const urls = pages.map((p) => absoluteUrl(p.path, origin))
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n')}
</urlset>
`
}

export function buildLlmsTxt(
  pages = allLandingPages(),
  origin = ORIGIN
): string {
  const lines = [
    '# chmonitor',
    '',
    '> Open-source ClickHouse monitoring dashboard — queries, storage, cluster health, AI agent, and MCP. Same codebase for self-hosted and cloud.',
    '',
    `HTML sitemap: ${origin}/sitemap.xml`,
    '',
    '## Marketing pages',
    '',
    ...pages.map((p) => {
      const href = absoluteUrl(p.path, origin)
      return `- [${p.title}](${href}): ${p.description}`
    }),
    '',
    '## Blog',
    '',
    `Index: https://blog.chmonitor.dev/llms.txt`,
    `Sitemap: https://blog.chmonitor.dev/sitemap.xml`,
    '',
    ...getPublishedBlogPosts().map(
      (post) => `- [${post.title}](${post.href}): ${post.description}`
    ),
    '',
    '## Documentation and product',
    '',
    '- [Docs (every page)](https://docs.chmonitor.dev/llms.txt)',
    '- [Docs full markdown](https://docs.chmonitor.dev/llms-full.txt)',
    '- [Hosted dashboard](https://dash.chmonitor.dev)',
    '- [GitHub](https://github.com/chmonitor/chmonitor)',
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
