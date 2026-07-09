// Site-wide constants shared across layouts and routes.

export const appName = 'chmonitor'

// Current documentation version. Surfaced as a badge in the nav and used by the
// version switcher. Bump this when a new docs version is cut.
export const docsVersion = 'v0.3'

// Published documentation versions, newest first. Drives the version-switcher
// dropdown in the nav. Add an entry (and flip `current`) when a new version is
// cut; `href` points at that version's release notes.
export interface DocsVersionEntry {
  label: string
  href: string
  current?: boolean
}

export const docsVersions: DocsVersionEntry[] = [
  { label: 'v0.3', href: '/reference/releases/v0-3', current: true },
]

// Docs are served at the site root (docs.chmonitor.dev/).
// Empty string means the base URL for doc pages is '/'.
export const docsRoute = ''

// Canonical origin for the docs site — used to build absolute canonical/OG
// URLs in per-route `head()` metadata and the sitemap.
export const siteUrl = 'https://docs.chmonitor.dev'

// Production dashboard URL (linked from the sidebar footer + home hero).
export const dashboardUrl = 'https://dash.chmonitor.dev'

// GitHub repository info — used for "Edit on GitHub" links.
export const gitConfig = {
  user: 'chmonitor',
  repo: 'chmonitor',
  branch: 'main',
}
