import type { APIContext } from 'astro'

import { buildSitemapXml } from '../lib/site-urls'

export function GET(_context: APIContext) {
  return new Response(buildSitemapXml(), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
