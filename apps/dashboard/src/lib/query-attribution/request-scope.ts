/**
 * Request side of query attribution (issue #4164).
 *
 * Every dashboard query is sent from inside an HTTP request: pages, charts,
 * the SQL console, the agent, and the cron triggers (Cloudflare routes
 * scheduled events to these GET routes). So one request middleware opens the
 * scope for all of them. The source comes from the route path, the page from
 * the `Referer` path, and the principal from the active auth provider.
 */

import type { AttributionScope } from '@chm/clickhouse-client/attribution'

/** Route prefix → source. First match wins, so keep specific entries first. */
const SOURCE_ROUTES: ReadonlyArray<
  readonly [prefix: string, source: (rest: string) => string]
> = [
  ['/api/v1/charts/batch', () => 'chart:batch'],
  ['/api/v1/charts/', (rest) => `chart:${rest}`],
  ['/api/v1/tables/', (rest) => `table:${rest}`],
  ['/api/v1/explorer/query', () => 'console'],
  ['/api/v1/explorer/', (rest) => `explorer:${rest}`],
  ['/api/v1/agent', () => 'agent'],
  ['/api/v1/advisor', () => 'agent'],
  ['/api/v1/insights', () => 'insights'],
  ['/api/mcp', () => 'mcp'],
  ['/api/cron/', (rest) => `cron:${rest}`],
]

function firstSegment(path: string): string {
  return decodeURIComponentSafe(path.split('/')[0] ?? '')
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** `chart:query-count`, `cron:health-sweep`, … or `api:<path>` for anything else. */
export function sourceFromPath(pathname: string): string {
  for (const [prefix, source] of SOURCE_ROUTES) {
    if (pathname.startsWith(prefix)) {
      return source(firstSegment(pathname.slice(prefix.length)))
    }
  }
  return `api:${pathname}`
}

/** Path of a same-origin `Referer`, or `null`. Cross-origin referrers are not our pages. */
export function pageFromReferer(
  referer: string | null,
  requestUrl: string
): string | null {
  if (!referer) return null
  try {
    const ref = new URL(referer)
    return ref.origin === new URL(requestUrl).origin ? ref.pathname : null
  } catch {
    return null
  }
}

export interface RequestPrincipal {
  readonly subject: string
  readonly email?: string
}

/**
 * Build the scope for one request. `resolvePrincipal` runs at most once, and
 * only when a query actually needs it.
 */
export function requestAttributionScope(
  request: Request,
  resolvePrincipal: () => Promise<RequestPrincipal | null>
): AttributionScope {
  let principal: Promise<RequestPrincipal | null> | undefined
  return {
    principal: () => {
      principal ??= resolvePrincipal()
      return principal
    },
    source: sourceFromPath(new URL(request.url).pathname),
    page:
      pageFromReferer(request.headers.get('referer'), request.url) ?? undefined,
  }
}
