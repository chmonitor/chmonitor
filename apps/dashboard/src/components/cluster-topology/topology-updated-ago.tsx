import { useEffect, useState } from 'react'

/**
 * Isolated "updated Ns ago" ticker. Lives in its own component so the 1s
 * interval cannot re-render TopologyView / TopoCanvas.
 */
export function TopologyUpdatedAgo({
  topology,
  liveRow,
}: {
  topology: unknown
  liveRow: unknown
}) {
  const [secsAgo, setSecsAgo] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the ticker when fresh topology/live data arrives
  useEffect(() => {
    setSecsAgo(0)
  }, [topology, liveRow])

  useEffect(() => {
    const t = setInterval(() => setSecsAgo((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  return <span className="tabular-nums">{secsAgo}s</span>
}
