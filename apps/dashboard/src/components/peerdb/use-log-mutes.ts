import { useCallback, useState } from 'react'
import {
  loadMutes,
  type MuteDuration,
  type MuteMap,
  muteFingerprint,
  saveMutes,
  unmuteFingerprint,
} from '@/lib/peerdb/log-mute'

/** Per-browser muted log patterns (localStorage, expiring). */
export function useLogMutes() {
  const [mutes, setMutes] = useState<MuteMap>(() => loadMutes())

  const mute = useCallback((fingerprint: string, duration: MuteDuration) => {
    setMutes((prev) => {
      const next = muteFingerprint(prev, fingerprint, duration)
      saveMutes(next)
      return next
    })
  }, [])

  const unmute = useCallback((fingerprint: string) => {
    setMutes((prev) => {
      const next = unmuteFingerprint(prev, fingerprint)
      saveMutes(next)
      return next
    })
  }, [])

  return { mutes, mute, unmute }
}
