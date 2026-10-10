/**
 * Per-browser mute list for log patterns, keyed by fingerprint. Stored in
 * localStorage; every storage access is guarded, so a blocked or full store
 * degrades to "nothing muted" instead of throwing. Muting only hides a pattern
 * in this browser's feed. It never affects alerts (PeerDB alert rules do).
 */

export const MUTE_STORAGE_KEY = 'chm:peerdb:muted-log-patterns'

/** Mute duration in ms, or `null` for "until unmuted". */
export type MuteDuration = number | null

export const MUTE_DURATIONS: { label: string; ms: MuteDuration }[] = [
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: 'Until unmuted', ms: null },
]

/** fingerprint -> expiry epoch ms, or null when it never expires. */
export type MuteMap = Record<string, number | null>

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Drops expired entries. */
export function pruneMutes(mutes: MuteMap, now: number): MuteMap {
  const out: MuteMap = {}
  for (const [fp, until] of Object.entries(mutes)) {
    if (until === null || until > now) out[fp] = until
  }
  return out
}

export function loadMutes(
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage()
): MuteMap {
  try {
    const raw = storage?.getItem(MUTE_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const mutes: MuteMap = {}
    for (const [fp, until] of Object.entries(parsed)) {
      if (until === null || typeof until === 'number') mutes[fp] = until
    }
    return pruneMutes(mutes, now)
  } catch {
    return {}
  }
}

/** Best effort. Returns false when the write failed (state stays in memory). */
export function saveMutes(
  mutes: MuteMap,
  storage: StorageLike | null = defaultStorage()
): boolean {
  try {
    if (!storage) return false
    storage.setItem(MUTE_STORAGE_KEY, JSON.stringify(mutes))
    return true
  } catch {
    return false
  }
}

export function muteFingerprint(
  mutes: MuteMap,
  fingerprint: string,
  duration: MuteDuration,
  now: number = Date.now()
): MuteMap {
  return {
    ...pruneMutes(mutes, now),
    [fingerprint]: duration === null ? null : now + duration,
  }
}

export function unmuteFingerprint(
  mutes: MuteMap,
  fingerprint: string
): MuteMap {
  const { [fingerprint]: _removed, ...rest } = mutes
  return rest
}

export function isMuted(
  mutes: MuteMap,
  fingerprint: string,
  now: number = Date.now()
): boolean {
  if (!Object.hasOwn(mutes, fingerprint)) return false
  const until = mutes[fingerprint]
  return until === null || until > now
}
