/**
 * "Configured first" classification for the alert-settings channel grid.
 *
 * The Alerts tab used to render every channel as a full-width form, so a fresh
 * install was a wall of blank inputs. These pure helpers decide which channels
 * are already set up (full card) and which are still offers (compact
 * "Add a channel" tile), for both delivery surfaces:
 *
 * - **browser-local** channels live in localStorage (`AlertSettings`): the
 *   browser channel counts as configured once it is enabled (it needs no
 *   target), the URL-based ones once their URL is non-empty.
 * - **server** channels live in D1 (`hasRow`) or, on a deployment without D1,
 *   in `HEALTH_ALERT_*` env vars (`envConfigured`) — either one means the
 *   operator has already set that channel up.
 *
 * Pure — no `window`, no I/O — so both the panel and its unit test can use it.
 */

import type { AlertSettings } from './alert-settings-storage'

/** The three channels the browser itself delivers (client dispatcher). */
export type LocalChannelId = 'browser' | 'healthchecks' | 'webhook'

export const LOCAL_CHANNEL_IDS: readonly LocalChannelId[] = [
  'browser',
  'healthchecks',
  'webhook',
]

/** True when the operator has already set this browser-local channel up. */
export function isLocalChannelConfigured(
  id: LocalChannelId,
  settings: AlertSettings
): boolean {
  switch (id) {
    case 'browser':
      return settings.browserNotificationsEnabled
    case 'healthchecks':
      return settings.healthchecksUrl.trim().length > 0
    case 'webhook':
      return settings.webhookUrl.trim().length > 0
  }
}

/** True when a server channel has a saved D1 row or a server env fallback. */
export function isServerChannelConfigured(input: {
  hasRow: boolean
  envConfigured: boolean
}): boolean {
  return input.hasRow || input.envConfigured
}

/**
 * Split an ordered id list into `configured` (full cards) and `available`
 * (compact add-tiles), preserving the input order within each bucket.
 */
export function partitionChannels<T>(
  ids: readonly T[],
  isConfigured: (id: T) => boolean
): { configured: T[]; available: T[] } {
  const configured: T[] = []
  const available: T[] = []
  for (const id of ids) {
    if (isConfigured(id)) configured.push(id)
    else available.push(id)
  }
  return { configured, available }
}
