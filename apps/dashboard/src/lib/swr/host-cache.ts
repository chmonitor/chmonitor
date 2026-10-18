import type { HostInfo } from '@chm/types/host-info'

/**
 * Dedicated localStorage cache for the configured host list.
 *
 * Why separate from the persisted TanStack Query cache (lib/query/provider.tsx)?
 * That cache is wiped on every deploy by a git-SHA buster, because query shapes
 * can change between builds. The host list, by contrast, has a stable shape
 * ({@link HostInfo}: id/name/host/user) and is the very first thing every page
 * needs to render its host selector. Caching it independently lets the selector
 * paint instantly even on the first load after a deploy — then `useHosts`
 * revalidates it in the background (stale-while-revalidate).
 */
const HOST_CACHE_KEY = 'chm-tsr-hosts'

/** TanStack Query key for the configured host list. Shared so the cache seed
 * (use-hosts.ts) and any future consumer key off the same string. */
export const HOSTS_QUERY_KEY = ['/api/v1/hosts'] as const

export function readCachedHosts(): HostInfo[] | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(HOST_CACHE_KEY)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return undefined
    // Light structural guard — a stale/corrupt entry shouldn't crash render.
    if (
      parsed.every(
        (h): h is HostInfo =>
          typeof h === 'object' &&
          h !== null &&
          typeof (h as HostInfo).id === 'number' &&
          typeof (h as HostInfo).name === 'string'
      )
    ) {
      return parsed
    }
    return undefined
  } catch {
    return undefined
  }
}

export function writeCachedHosts(hosts: HostInfo[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(HOST_CACHE_KEY, JSON.stringify(hosts))
  } catch {
    // Quota / private-mode failures are non-fatal — caching is best-effort.
  }
}
