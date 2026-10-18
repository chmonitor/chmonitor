/**
 * Dismissed "Connect your own cluster" banner storage.
 *
 * A single per-browser flag — unlike `lib/notifications/dismissed-notifications.ts`
 * there is only ever one banner to dismiss, so no key set is needed.
 */

const STORAGE_KEY = 'chm-sample-cluster-banner-dismissed'

export function isSampleClusterBannerDismissed(): boolean {
  if (typeof window === 'undefined') return false

  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissSampleClusterBanner(): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {}
}
