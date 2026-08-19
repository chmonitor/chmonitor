import { WHATS_NEW_AUTO_OPEN_SESSION_KEY } from './constants'
import { normalizeVersion } from './version'

export function readAutoOpenedVersion(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.sessionStorage.getItem(WHATS_NEW_AUTO_OPEN_SESSION_KEY) ?? ''
  } catch {
    return ''
  }
}

export function markAutoOpenedVersion(appVersion: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(
      WHATS_NEW_AUTO_OPEN_SESSION_KEY,
      normalizeVersion(appVersion)
    )
  } catch {
    // sessionStorage can throw in private mode; skip is fine.
  }
}

export function shouldAutoOpenChangelog(input: {
  appVersion: string
  hasUpgrade: boolean
  alreadyOpenedVersion: string
}): boolean {
  if (!input.hasUpgrade) return false
  return (
    normalizeVersion(input.alreadyOpenedVersion) !==
    normalizeVersion(input.appVersion)
  )
}
