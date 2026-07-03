// Product analytics enablement gate. OFF by default — a hard no-op unless an
// analytics key is configured (key-presence gating, mirroring
// lib/observability/sentry-options.ts) rather than lib/telemetry/config.ts's
// "on unless explicitly disabled" — this is a marketing/growth capability, not
// aggregate OSS telemetry, so a self-hosted instance must never phone home to
// a third-party analytics platform without an explicit opt-in key.
//
// Respects the browser Do Not Track signal (navigator.doNotTrack) as required,
// and additionally honors the cross-tool DO_NOT_TRACK env convention already
// wired for telemetry (reused via isDoNotTrack, not duplicated) as a hard
// override.

import { isDoNotTrack } from '@/lib/telemetry/config'

/** True when a PostHog project key is configured (non-empty after trim). */
export function isAnalyticsConfigured(key: string | undefined): boolean {
  return Boolean(key?.trim())
}

/** True when the browser's Do Not Track signal is set. False outside a browser. */
export function isBrowserDoNotTrack(): boolean {
  if (typeof navigator === 'undefined') return false
  // DNT values are '1' (opt out), '0' (allowed), or unspecified — only '1'
  // means opt out.
  return navigator.doNotTrack === '1'
}

export function isAnalyticsEnabled(input: {
  key: string | undefined
  envDoNotTrack?: string | undefined
}): boolean {
  if (!isAnalyticsConfigured(input.key)) return false
  if (isBrowserDoNotTrack()) return false
  if (isDoNotTrack(input.envDoNotTrack)) return false
  return true
}
