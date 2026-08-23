import type { APIContext } from 'astro'

import { buildLlmsTxt } from '../lib/site-urls'

export function GET(_context: APIContext) {
  return new Response(buildLlmsTxt(), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
