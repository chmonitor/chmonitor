import { createFileRoute } from '@tanstack/react-router'

import { siteUrl } from '@/lib/shared'
import { source } from '@/lib/source'

// /sitemap.xml — the home page plus every documentation page, for search
// engine crawlers. robots.txt points here.
export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET() {
        const urls = [
          siteUrl,
          ...source.getPages().map((page) => `${siteUrl}${page.url}`),
        ]
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc></url>`).join('\n')}
</urlset>
`
        return new Response(body, {
          headers: { 'Content-Type': 'application/xml; charset=utf-8' },
        })
      },
    },
  },
})
