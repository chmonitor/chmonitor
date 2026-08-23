import {
  landingRedirectUrl,
  previewRobotsTxt,
  shouldNoindexHost,
} from './seo-routing'

export interface LandingEnv {
  ASSETS: { fetch: typeof fetch }
}

export default {
  async fetch(request: Request, env: LandingEnv): Promise<Response> {
    const url = new URL(request.url)

    if (shouldNoindexHost(url.hostname) && url.pathname === '/robots.txt') {
      return new Response(previewRobotsTxt(), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Robots-Tag': 'noindex, nofollow',
        },
      })
    }

    const dest = landingRedirectUrl(url)
    if (dest) {
      return Response.redirect(dest, 301)
    }

    const asset = await env.ASSETS.fetch(request)
    if (!shouldNoindexHost(url.hostname)) return asset

    const headers = new Headers(asset.headers)
    headers.set('X-Robots-Tag', 'noindex, nofollow')
    return new Response(asset.body, { status: asset.status, headers })
  },
}
