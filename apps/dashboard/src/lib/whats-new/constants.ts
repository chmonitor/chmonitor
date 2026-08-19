/** Public GitHub Releases listing. Fetched server-side only. */
export const GITHUB_RELEASES_API_URL =
  'https://api.github.com/repos/chmonitor/chmonitor/releases?per_page=20'

export const GITHUB_RELEASES_PAGE_URL =
  'https://github.com/chmonitor/chmonitor/releases'

export const LANDING_CHANGELOG_URL = 'https://chmonitor.dev/changelog'

export const RELEASES_CACHE_TTL_MS = 60 * 60 * 1000

export const RELEASES_FETCH_TIMEOUT_MS = 8_000

export const MAX_RELEASES = 20

/** Latest product versions baked into the airgap snapshot (not the full CHANGELOG). */
export const AIRGAP_SNAPSHOT_LIMIT = 5

/** Dashboard app version used for the unseen / auto-open comparison. */
export const APP_VERSION_STORAGE_KEY = 'lastSeenChangelogVersion'

export const WHATS_NEW_AUTO_OPEN_SESSION_KEY = 'chm-whats-new-auto-opened'
