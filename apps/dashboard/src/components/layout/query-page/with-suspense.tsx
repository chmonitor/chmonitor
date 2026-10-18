/** Wraps a page in Suspense; `useSearchParams()` (via `useHostId()`) requires a boundary. */

import { type ComponentType, Suspense } from 'react'
import { ChartSkeleton } from '@/components/skeletons'

export function withSuspense<P extends object>(
  Component: ComponentType<P>,
  fallback: React.ReactNode = <ChartSkeleton />
): ComponentType<P> {
  const WrappedComponent = (props: P) => (
    <Suspense fallback={fallback}>
      <Component {...props} />
    </Suspense>
  )

  WrappedComponent.displayName = `withSuspense(${
    Component.displayName || Component.name || 'Component'
  })`

  return WrappedComponent
}
