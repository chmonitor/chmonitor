import { redirect } from '@tanstack/react-router'
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from '@tanstack/react-start'

import { slugsToMarkdownPath } from './lib/source'
import { isMarkdownPreferred } from 'fumadocs-core/negotiation'

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

// LLM negotiation middleware: if a request to a doc page includes
// `Accept: text/markdown`, redirect to the raw .md endpoint.
const llmMiddleware = createMiddleware().server(({ next, request }) => {
  const url = new URL(request.url)
  const path = url.pathname

  // Skip API, OG, and asset routes.
  if (
    path.startsWith('/api/') ||
    path.startsWith('/og/') ||
    path.endsWith('.md') ||
    path.includes('.')
  ) {
    return next()
  }

  if (isMarkdownPreferred(request)) {
    const slugs = path.split('/').filter(Boolean)
    const { url: mdUrl } = slugsToMarkdownPath(slugs)
    throw redirect(new URL(mdUrl, request.url))
  }

  return next()
})

// Public-cache middleware: mark public, non-personalized GET responses (doc
// pages, the raw .md / llms.txt endpoints, OG images) cacheable so Cloudflare
// Workers Cache (enabled in wrangler.toml) can serve HITs without running this
// Worker. `stale-while-revalidate` serves stale instantly while refreshing in
// the background. The docs site has no per-user content, so `public` is safe.
//
// Skipped: `/api/*` (e.g. the search index endpoint) is left to set its own
// caching, and any response that already declares `Cache-Control` is respected.
// Requests carrying `Authorization` are additionally auto-bypassed by Workers
// Cache itself. See docs/knowledge/workers-cache.md.
const PUBLIC_CACHE_CONTROL =
  'public, max-age=300, stale-while-revalidate=86400'

const cacheHeadersMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const result = await next()

    const url = new URL(request.url)
    const response = result?.response
    if (
      response &&
      request.method === 'GET' &&
      response.status === 200 &&
      !url.pathname.startsWith('/api/') &&
      !request.headers.has('authorization') &&
      !response.headers.has('cache-control')
    ) {
      response.headers.set('Cache-Control', PUBLIC_CACHE_CONTROL)
    }

    return result
  },
)

export const startInstance = createStart(() => ({
  // cacheHeadersMiddleware runs outermost so it can stamp Cache-Control on the
  // final response returned by the inner middlewares/handlers.
  requestMiddleware: [cacheHeadersMiddleware, csrfMiddleware, llmMiddleware],
}))
