// NOTE: intentionally NOT a 'use client' module and — crucially — free of any
// static import of hook-using browser code. The query-config registry that
// references this factory is eagerly imported by server/Worker API routes, so
// pulling `useHostId`/`useQuery` in at module scope here would evaluate browser
// code on the server. The real, hook-using panel is loaded with `React.lazy`,
// so it is only ever fetched in the browser when a user expands a row.

import type { ExpandedRenderer } from '@/types/query-config'

import { lazy, Suspense } from 'react'

const LazyPanel = lazy(() => import('./query-metric-log-expanded-details'))

/**
 * Factory returning an {@link ExpandedRenderer} for the Query Metric Log table.
 * Lives in this `.tsx` module so the plain `.ts` query-config can opt into the
 * bespoke, lazily-fetched row-expand panel without importing JSX (or the panel's
 * client-only dependencies) itself.
 */
export function createQueryMetricLogExpandedDetails(): ExpandedRenderer {
  return (row) => (
    <Suspense
      fallback={
        <p className="text-xs text-muted-foreground">Loading details…</p>
      }
    >
      <LazyPanel row={row as Record<string, unknown>} />
    </Suspense>
  )
}
