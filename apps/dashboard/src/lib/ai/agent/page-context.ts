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

export function buildPageContext(pathname: string): PageContext {
  return { route: pathname, label: getPageLabel(pathname) }
}
