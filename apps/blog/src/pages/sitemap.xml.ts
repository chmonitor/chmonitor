import type { APIContext } from 'astro'

import { buildSitemapXml } from '../lib/crawler-index'
import { getCollection } from 'astro:content'

export async function GET(_context: APIContext) {
  const posts = await getCollection('blog')
  return new Response(buildSitemapXml(posts), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
