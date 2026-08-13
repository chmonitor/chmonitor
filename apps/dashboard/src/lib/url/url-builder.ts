/**
 * URL builder utility for constructing URLs with query parameters.
 *
 * Handles cases where the base URL may already contain query parameters,
 * automatically using the correct separator (`?` or `&`).
 *
 * @example
 * ```ts
 * import { buildUrl } from '@/lib/url/url-builder'
 *
 * // Base URL without query params
 * buildUrl('/overview', { host: 0 })
 * // Returns: '/overview?host=0'
 *
 * // Base URL with existing query params
 * buildUrl('/table?database=default', { host: 1, table: 'users' })
 * // Returns: '/table?database=default&host=1&table=users'
 *
 * // Merge with existing search params
 * buildUrl('/table', { host: 1 }, 'database=default&status=active')
 * // Returns: '/table?host=1&database=default&status=active'
 *
 * // Undefined values are ignored
 * buildUrl('/overview', { host: 0, filter: undefined })
 * // Returns: '/overview?host=0'
 * ```
 *
 * @param baseUrl - The base URL path
 * @param params - Object containing query parameters
 * @param existingSearchParams - Optional existing query params to merge
 * @returns Complete URL with query parameters
 */
export function buildUrl(
  baseUrl: string,
  params: Record<string, string | number | boolean | undefined>,
  existingSearchParams?: URLSearchParams | string
): string {
  const separator = baseUrl.includes('?') ? '&' : '?'
  const searchParams = new URLSearchParams(existingSearchParams)

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      searchParams.set(key, String(value))
    }
  })

  const queryString = searchParams.toString()
  return queryString ? `${baseUrl}${separator}${queryString}` : baseUrl
}

/**
 * Split a `href` string (path with an optional `?query` string, e.g. the
 * output of {@link buildUrl}) into the `{ to, search }` shape TanStack
 * Router's `router.navigate` expects.
 *
 * `router.navigate({ to: '/explorer?database=default' })` treats the WHOLE
 * string as the path, so the `?query` gets percent-encoded into the pathname
 * (e.g. `/explorer%3Fdatabase=default`) instead of being parsed as search
 * params. Parsing the query out and passing it as `search` makes a plain
 * `href` string navigate correctly: `router.navigate(splitHref(href))`.
 *
 * Note: `search` here is a plain object, which TanStack Router treats as a
 * full replacement of the current search state (not a merge) — this mirrors
 * the app's existing href-based navigation convention, so `host`/other
 * params not present in `href` are dropped unless the caller included them.
 */
export function splitHref(href: string): {
  to: string
  search?: Record<string, string>
} {
  const queryIndex = href.indexOf('?')
  if (queryIndex === -1) return { to: href }
  const to = href.slice(0, queryIndex)
  const search = Object.fromEntries(
    new URLSearchParams(href.slice(queryIndex + 1))
  )
  return { to, search }
}
