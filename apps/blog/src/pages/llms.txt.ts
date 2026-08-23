import type { APIContext } from 'astro'

import { buildLlmsTxt } from '../lib/crawler-index'
import { getCollection } from 'astro:content'

// /llms.txt — every published post and category. https://llmstxt.org
export async function GET(_context: APIContext) {
  const posts = await getCollection('blog')
  return new Response(buildLlmsTxt(posts), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
