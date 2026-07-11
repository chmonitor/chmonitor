import {
  DEFAULT_FLEET_VIEW,
  type FleetView,
  readFleetView,
  writeFleetView,
} from './fleet-helpers'
import { useCallback, useEffect, useState } from 'react'

/**
 * Fleet Overview view-mode state, persisted in localStorage (key `fleet-view`).
 *
 * Starts from the default so the static (SSR/prerender) shell is deterministic,
 * then hydrates the persisted choice on mount to avoid a hydration mismatch.
 */
export function useFleetView(): [FleetView, (view: FleetView) => void] {
  const [view, setViewState] = useState<FleetView>(DEFAULT_FLEET_VIEW)

  useEffect(() => {
    setViewState(readFleetView())
  }, [])

  const setView = useCallback((next: FleetView) => {
    setViewState(next)
    writeFleetView(next)
  }, [])

  return [view, setView]
}
