/**
 * Smart prefix grouping for named jobs (PeerDB mirrors).
 *
 * Splits names on `_` / `-` / `.` / `/` and groups items that share a token
 * prefix, preferring the longest prefix whose remaining suffix looks volatile
 * (dates like `202608`, ISO dates, `v2`, hashes, numeric ids). Display uses a
 * wildcard: `qrep_sg_fleetreporting1_*`.
 *
 * Depth-1 groups (`qrep_*`) are skipped unless the next token is volatile, so
 * a fleet of `qrep_sg_orders_*` + `qrep_sg_users_*` does not collapse into one
 * coarse `qrep_*` bucket.
 */

export interface PrefixGroup<T> {
  /** Display wildcard, e.g. `qrep_sg_fleetreporting1_*`. */
  wildcard: string
  /** Shared prefix without the trailing separator, e.g. `qrep_sg_fleetreporting1`. */
  prefix: string
  items: T[]
}

export interface PrefixGrouping<T> {
  groups: PrefixGroup<T>[]
  ungrouped: T[]
}

export interface SplitName {
  tokens: string[]
  /** Separator that followed tokens[i]; seps.length === tokens.length - 1 when well-formed. */
  seps: string[]
}

export function splitName(name: string): SplitName {
  const tokens: string[] = []
  const seps: string[] = []
  let buf = ''
  for (const ch of name) {
    if (ch === '_' || ch === '-' || ch === '.' || ch === '/') {
      if (buf.length > 0) {
        tokens.push(buf)
        seps.push(ch)
        buf = ''
      }
    } else {
      buf += ch
    }
  }
  if (buf.length > 0) tokens.push(buf)
  return { tokens, seps }
}

/**
 * True when a token is a date, version, hash, or long numeric id — the kind of
 * suffix that should collapse into a `prefix_*` group rather than stay as a
 * distinct job name.
 */
export function isVolatileToken(token: string): boolean {
  return /^(?:\d{6,8}|\d{4}-\d{2}(?:-\d{2})?|v?\d+(?:\.\d+)*|[0-9a-f]{8,}|\d{4,})$/i.test(
    token
  )
}

function joinPrefix(split: SplitName, depth: number): string {
  let prefix = split.tokens[0] ?? ''
  for (let i = 1; i < depth; i++) {
    prefix += (split.seps[i - 1] ?? '_') + split.tokens[i]
  }
  return prefix
}

export function wildcardFor(split: SplitName, depth: number): string {
  const prefix = joinPrefix(split, depth)
  const sep = split.seps[depth - 1] ?? '_'
  return `${prefix}${sep}*`
}

export function groupBySmartPrefix<T>(
  items: T[],
  nameOf: (item: T) => string,
  options?: { minGroupSize?: number }
): PrefixGrouping<T> {
  const minGroupSize = options?.minGroupSize ?? 2
  const named = items.map((item) => ({
    item,
    split: splitName(nameOf(item)),
  }))

  type Candidate = {
    key: string
    depth: number
    volatile: boolean
    members: typeof named
  }

  const buckets = new Map<string, typeof named>()
  for (const row of named) {
    const { tokens } = row.split
    for (let depth = 1; depth < tokens.length; depth++) {
      const key = `${depth}:${tokens.slice(0, depth).join('\0')}`
      const list = buckets.get(key)
      if (list) list.push(row)
      else buckets.set(key, [row])
    }
  }

  const candidates: Candidate[] = []
  for (const [key, members] of buckets) {
    if (members.length < minGroupSize) continue
    const depth = Number(key.slice(0, key.indexOf(':')))
    const volatile = members.every((m) =>
      isVolatileToken(m.split.tokens[depth] ?? '')
    )
    if (depth < 2 && !volatile) continue
    candidates.push({ key, depth, volatile, members })
  }

  candidates.sort((a, b) => {
    if (a.volatile !== b.volatile) return a.volatile ? -1 : 1
    if (b.depth !== a.depth) return b.depth - a.depth
    return b.members.length - a.members.length
  })

  const assigned = new Set<T>()
  const groups: PrefixGroup<T>[] = []

  for (const c of candidates) {
    const free = c.members.filter((m) => !assigned.has(m.item))
    if (free.length < minGroupSize) continue
    const sample = free[0].split
    groups.push({
      wildcard: wildcardFor(sample, c.depth),
      prefix: joinPrefix(sample, c.depth),
      items: free.map((m) => m.item),
    })
    for (const m of free) assigned.add(m.item)
  }

  groups.sort((a, b) => a.wildcard.localeCompare(b.wildcard))
  const ungrouped = items.filter((it) => !assigned.has(it))
  return { groups, ungrouped }
}
