export type NamedDelta<T extends { name: string }> = {
  added: T[]
  removed: T[]
  changed: Array<{ name: string; source: T; target: T }>
}

/** Diff named items: added = source-only, removed = target-only. */
export function namedDelta<T extends { name: string }>(
  source: T[],
  target: T[],
  equal: (a: T, b: T) => boolean
): NamedDelta<T> {
  const sourceMap = new Map(source.map((item) => [item.name, item]))
  const targetMap = new Map(target.map((item) => [item.name, item]))
  const added: T[] = []
  const removed: T[] = []
  const changed: Array<{ name: string; source: T; target: T }> = []

  for (const [name, src] of sourceMap) {
    const tgt = targetMap.get(name)
    if (!tgt) {
      added.push(src)
      continue
    }
    if (!equal(src, tgt)) {
      changed.push({ name, source: src, target: tgt })
    }
  }

  for (const [name, tgt] of targetMap) {
    if (!sourceMap.has(name)) removed.push(tgt)
  }

  return { added, removed, changed }
}
