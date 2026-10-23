// The query-config registry that references this factory is imported by
// server/Worker API routes, so the hook-using panel is loaded with
// `React.lazy` and only ever evaluates in the browser when a row is expanded.

import type { ExpandedRenderer } from '@/types/query-config'

import { lazy, Suspense } from 'react'

const LazyPanel = lazy(() => import('./user-expanded-details'))

export function createUserExpandedDetails(): ExpandedRenderer {
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
