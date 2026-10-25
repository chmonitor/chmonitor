import { useEffect, useState } from 'react'
import { useVisibleInterval } from '@/hooks/use-visible-interval'

/**
 * Isolated "updated Ns ago" ticker. Lives in its own component so the 1s
 * interval cannot re-render TopologyView / TopoCanvas. Elapsed time is derived
 * from a timestamp, so a hidden tab does not undercount when it becomes visible.
 */
export function TopologyUpdatedAgo({
  topology,
  liveRow,
}: {
  topology: unknown
  liveRow: unknown
}) {
  const [updatedAt, setUpdatedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the ticker when fresh topology/live data arrives
  useEffect(() => {
    setUpdatedAt(Date.now())
    setNow(Date.now())
  }, [topology, liveRow])

  useVisibleInterval(() => setNow(Date.now()), 1000)

  const secsAgo = Math.max(0, Math.floor((now - updatedAt) / 1000))
  return <span className="tabular-nums">{secsAgo}s</span>
}
