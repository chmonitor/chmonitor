import { createFileRoute } from '@tanstack/react-router'

import { buildSitemapXml } from '@/lib/crawler-index'
import { source } from '@/lib/source'

// /sitemap.xml — every documentation HTML page, for search engine crawlers.
// robots.txt points here.
export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET() {
        const pages = source.getPages().map((page) => ({
          url: page.url,
          title: page.data.title,
          description: page.data.description,
        }))
        return new Response(buildSitemapXml(pages), {
          headers: { 'Content-Type': 'application/xml; charset=utf-8' },
        })
      },
    },
  },
})
