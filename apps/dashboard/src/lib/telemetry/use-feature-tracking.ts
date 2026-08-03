// useFeatureTracking hook
//
// A thin, fire-and-forget wrapper around track('feature_viewed', …). Call it
// once inside any page or feature component's useEffect to record that the user
// navigated to / viewed that feature.
//
// It is a HARD no-op unless telemetry is enabled (track() gates internally),
// so it is always safe to call unconditionally.

import { track } from './track'
import { useEffect } from 'react'

/**
 * Tracks a `feature_viewed` event for the given feature name.
 *
 * @example
 * ```tsx
 * function MyPage() {
 *   useFeatureTracking('overview')
 *   return <PageContent />
 * }
 * ```
 *
 * @param feature - Short, stable feature identifier (e.g. 'overview', 'tables',
 *   'explorer', 'sql_console'). Must not contain PII or hostnames.
 */
export function useFeatureTracking(feature: string): void {
  useEffect(() => {
    track('feature_viewed', { feature })
  }, [feature])
}
