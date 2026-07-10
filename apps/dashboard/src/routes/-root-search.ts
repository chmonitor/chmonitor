/**
 * Root route `?host=` search-param validation.
 *
 * Extracted from `__root.tsx` into its own module (the `-` prefix keeps
 * TanStack Router from treating it as a route file) so it can be unit tested
 * without pulling in `__root.tsx`'s CSS/provider imports, which don't resolve
 * under `bun test`.
 */

// Typed global `?host=` search param, declared on the ROOT so every route
// inherits it and useHostId can read it via useSearch({ strict: false }).
// Mirrors the Next app's host parsing (Number() coerce, fall back to 0).
export interface RootSearch {
  host: number
}

/**
 * `?host` must be a finite integer; anything else (missing, `NaN`,
 * fractional, `Infinity`) defaults to host `0`. Negative integers are kept —
 * they identify client-side browser/database connections (see
 * `isCustomHost` in `lib/host-fetch/resolve-host-fetch.ts`), not server-side
 * env hosts, so this validator must not reject them.
 */
export function validateSearch(search: Record<string, unknown>): RootSearch {
  const parsed = Number(search.host)
  return {
    host: Number.isInteger(parsed) ? parsed : 0,
  }
}
