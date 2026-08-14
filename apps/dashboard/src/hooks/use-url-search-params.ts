import { useRouterState } from '@tanstack/react-router'

import { useMemo } from 'react'

/**
 * Read-only `URLSearchParams` for the current URL's query string.
 *
 * TanStack Router's default search parser (`parseSearchWith(JSON.parse)`)
 * JSON-parses every search value, so `Route.useSearch()` silently turns
 * `?query_id=12345` into the *number* `12345` (and `?enabled=true` into a
 * *boolean*) instead of leaving it a string. That's a real behavior change
 * for any consumer expecting `URLSearchParams`-style string semantics
 * (`.get()`, `.toString()`, iteration, re-serializing into another URL) — and
 * several call sites here do exactly that (building hrefs, merging filter
 * params, the legacy `/{hostId}/...` redirect). This hook sidesteps the
 * parser entirely by reading the raw query string from router state and
 * parsing it with the standard `URLSearchParams` constructor, matching the
 * exact semantics of Next.js's `useSearchParams()` (which this hook replaces
 * app-wide — see `docs/knowledge/tsr-migration.md`).
 *
 * Sourced from the router's location state — which exists during prerender
 * and updates on navigation — so it is reactive and SSR-safe (no bare
 * `window.location` read that throws when the chrome renders on the server).
 *
 * For a single, known-non-numeric param (e.g. a tab id), prefer TanStack's
 * own `useSearch({ strict: false })` — see `alert-settings.tsx` /
 * `health-settings.tsx` for that established pattern. Reach for this hook
 * when you need `URLSearchParams` itself, or when the value could plausibly
 * be numeric/boolean-looking.
 */
export function useUrlSearchParams(): URLSearchParams {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr })
  // Memoize on searchStr so the URLSearchParams keeps a stable identity while
  // the query string is unchanged. Consumers (e.g. legacy-url-redirect) put
  // the result in effect deps; a fresh object every render would re-run those
  // effects on unrelated re-renders.
  return useMemo(() => new URLSearchParams(searchStr), [searchStr])
}
