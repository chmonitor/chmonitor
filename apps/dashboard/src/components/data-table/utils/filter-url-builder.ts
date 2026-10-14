import type { QueryConfig } from '@/types/query-config'

import { buildUrl } from '@/lib/url/url-builder'

/**
 * Generate updated href when a filter is toggled
 *
 * Handles proper URL param management with respect to default values:
 * - If default value exists: set param to empty string instead of deleting
 * - If default value is empty: delete the param completely
 *
 * @example
 * // With defaultParams = { type: 'abc' } and URL ?type=abc
 * getUpdatedHref('/path', params, 'type', 'abc', { type: 'abc' })
 * // Returns: '/path?type=' (keeps key, clears value)
 *
 * @example
 * // With defaultParams = { type: '' } and URL ?type=abc
 * getUpdatedHref('/path', params, 'type', 'abc', { type: '' })
 * // Returns: '/path' (removes key completely)
 */
export function getFilterToggleHref(
  pathname: string,
  searchParams: URLSearchParams,
  key: string,
  value: string,
  defaultParams: QueryConfig['defaultParams']
): string {
  const newParams = new URLSearchParams(searchParams)

  if (newParams.get(key) === value) {
    if (defaultParams?.[key] !== '') {
      // Has default value - set to empty instead of deleting
      newParams.set(key, '')
    } else {
      // No default value - delete completely
      newParams.delete(key)
    }
  } else {
    newParams.set(key, value)
  }

  return buildUrl(pathname, {}, newParams)
}
