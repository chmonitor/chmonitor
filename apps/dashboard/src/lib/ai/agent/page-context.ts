/**
 * Client-side helper for deriving the "page context" hint sent to the chat
 * agent (`pageContext` on `/api/v1/agent`'s request body — see
 * `routes/api/v1/agent.ts`'s `sanitizePageContext` / `buildPageContextLine`).
 *
 * Kept in its own module (rather than inline in the runtime provider) so it
 * has no React dependency and can be unit tested directly.
 */

import { getBreadcrumbPath } from '@/lib/menu/breadcrumb'

export type PageContext = {
  route: string
  label?: string
}

/**
 * Resolve a human-readable page label for a pathname via the menu hierarchy
 * (same lookup the breadcrumb uses), falling back to `undefined` when the
 * route isn't registered — the server falls back to the raw route in that
 * case.
 */
export function getPageLabel(pathname: string): string | undefined {
  const breadcrumbs = getBreadcrumbPath(pathname)
  if (breadcrumbs.length === 0) return undefined
  return breadcrumbs[breadcrumbs.length - 1]?.title
}

/** Build the `pageContext` hint for the given pathname. */
export function buildPageContext(pathname: string): PageContext {
  return { route: pathname, label: getPageLabel(pathname) }
}
