/** Rotating hero taglines — monitoring-first, AI as one angle among several. */
export const HERO_SLOGANS = [
  'Slow queries, caught before users complain.',
  'Replication lag on a live cluster map.',
  'System tables — no exporters, no sidecars.',
  'Merges, mutations and disk — one overview.',
  'An advisor when you need a second opinion.',
  'Self-hosted, Kubernetes, or cloud — same UI.',
] as const

export function heroSloganAt(index: number): string {
  const n = HERO_SLOGANS.length
  if (n === 0) return ''
  return HERO_SLOGANS[((index % n) + n) % n]
}
