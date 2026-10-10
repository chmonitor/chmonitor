import { groupBySmartPrefix } from './group-by-prefix'

/**
 * Maps a mirror name to the same prefix-group wildcard `/peerdb` shows
 * (`qrep_sg_fleetreporting1_*`). Mirrors in no group keep their own name.
 */
export function mirrorPrefixResolver(
  mirrors: Iterable<string>
): (mirror: string) => string {
  const names = [...new Set(mirrors)]
  const { groups } = groupBySmartPrefix(names, (n) => n)
  const label = new Map<string, string>()
  for (const g of groups) for (const m of g.items) label.set(m, g.wildcard)
  return (mirror) => label.get(mirror) ?? mirror
}
