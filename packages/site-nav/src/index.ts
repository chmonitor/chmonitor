/**
 * Shared site navigation model for chmonitor's public sites
 * (chmonitor.dev landing, blog.chmonitor.dev, telemetry.chmonitor.dev).
 *
 * Plain data + string renderers only — no deps, no DOM — so the same module
 * bundles into the Astro build and the wrangler-bundled telemetry Worker.
 *
 * `href` is a site-relative path ('/…') for on-site destinations or an
 * absolute URL for off-site ones (docs, blog, GitHub, dashboard). Consumers
 * prefix paths with their own origin helper — landing `to('')`, blog
 * `to('https://chmonitor.dev')`, telemetry `https://chmonitor.dev`.
 */

/** Icon slot for a Features-menu item. The consumer owns the glyphs — landing
 * maps each key to a Lucide path set; the key is all that is shared. */
export type FeatureIconKey =
  | 'aiAgent'
  | 'cli'
  | 'overview'
  | 'queries'
  | 'topology'
  | 'storage'
  | 'traffic'
  | 'alerting'
  | 'explorer'
  | 'insights'
  | 'peerdb'
  | 'postgres'

export interface NavItem {
  label: string
  /** Site-relative path ('/…') or absolute URL for off-site destinations. */
  href: string
  /** One-line blurb shown under the label in dropdown menus. */
  description?: string
  /** Short pill rendered next to the label (e.g. 'Beta'). */
  badge?: string
}

export interface FeatureNavItem extends NavItem {
  icon: FeatureIconKey
}

export const NAV_BRAND = {
  label: 'chmonitor',
  href: '/',
  logo: '/brand/logo-chmonitor.svg',
} as const

export const NAV_CTAS = {
  github: {
    href: 'https://github.com/chmonitor/chmonitor',
    label: 'Star',
    drawerLabel: 'Star on GitHub',
  },
  dashboard: {
    href: 'https://dash.chmonitor.dev',
    label: 'Dashboard',
  },
} as const

/** "Features" mega-menu, in render order. */
export const FEATURE_MENU: FeatureNavItem[] = [
  {
    label: 'AI Agent',
    href: '/features/ai-agent',
    description: 'Schema-aware recommendations & MCP',
    icon: 'aiAgent',
  },
  {
    label: 'CLI',
    href: '/cli',
    description: 'chm doctor, TUI and dashboard API',
    badge: 'Beta',
    icon: 'cli',
  },
  {
    label: 'Cluster overview',
    href: '/features/overview',
    description: 'Live charts the moment you connect',
    icon: 'overview',
  },
  {
    label: 'Query monitoring',
    href: '/features/queries',
    description: 'Running, slow, failed & expensive',
    icon: 'queries',
  },
  {
    label: 'Cluster topology',
    href: '/features/topology',
    description: 'Nodes, shards, replicas & Keeper',
    icon: 'topology',
  },
  {
    label: 'Storage & tables',
    href: '/features/storage',
    description: 'Sizes, compression and disk headroom',
    icon: 'storage',
  },
  {
    label: 'Traffic',
    href: '/features/traffic',
    description: 'Ingestion, compression & write amplification',
    icon: 'traffic',
  },
  {
    label: 'Alerting',
    href: '/features/alerting',
    description: 'Health checks with webhooks',
    icon: 'alerting',
  },
  {
    label: 'Data Explorer',
    href: '/features/data-explorer',
    description: 'Tables, lineage and SQL console',
    icon: 'explorer',
  },
  {
    label: 'Insights',
    href: '/features/insights',
    description: 'AI findings and cluster vitals',
    icon: 'insights',
  },
  {
    label: 'PeerDB replication',
    href: '/features/peerdb',
    description: 'Postgres → ClickHouse CDC',
    icon: 'peerdb',
  },
  {
    label: 'Postgres',
    href: '/features/postgres',
    description: 'Monitor Postgres alongside',
    badge: 'Beta',
    icon: 'postgres',
  },
]

/** Top-level links between the two dropdowns. */
export const TOP_LEVEL_LINKS: NavItem[] = [
  { label: 'Customers', href: '/customers' },
  { label: 'License', href: '/license' },
  { label: 'Docs', href: 'https://docs.chmonitor.dev' },
]

/** "Resources" dropdown. */
export const RESOURCE_MENU: NavItem[] = [
  {
    label: 'Blog',
    href: 'https://blog.chmonitor.dev',
    description: 'Release notes and product updates',
  },
  {
    label: 'Changelog',
    href: '/changelog',
    description: 'Release notes and full ship log',
  },
  {
    label: 'Docs',
    href: 'https://docs.chmonitor.dev',
    description: 'Setup, deploy and API guides',
  },
  {
    label: 'Brand',
    href: '/brand',
    description: 'Logos and brand assets',
  },
]

/** Mobile-drawer Resources: drops items already reachable as top-level links
 * (Docs) so the drawer doesn't list the same destination twice. */
export const RESOURCE_DRAWER_ITEMS = RESOURCE_MENU.filter(
  (item) => !TOP_LEVEL_LINKS.some((link) => link.href === item.href)
)

export const isExternalHref = (href: string): boolean => !href.startsWith('/')

/** Resolve an item href for a consumer on `origin` ('' for same-site). */
export function navHref(item: NavItem, origin = ''): string {
  return isExternalHref(item.href) ? item.href : `${origin}${item.href}`
}

// ─── String renderers (non-Astro consumers: the telemetry Worker) ────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const CHEVRON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'

function anchorAttrs(item: NavItem, origin: string): string {
  const ext = isExternalHref(item.href)
  return `href="${navHref(item, origin)}"${ext ? ' target="_blank" rel="noopener"' : ''}`
}

function badgeHtml(item: NavItem): string {
  return item.badge
    ? `<span class="nav-badge">${escapeHtml(item.badge)}</span>`
    : ''
}

/** Menu anchor: label (+ optional badge) with the description `<small>`. */
function menuAnchor(item: NavItem, origin: string): string {
  const label = item.badge
    ? `<span class="nav-item-label">${escapeHtml(item.label)}${badgeHtml(item)}</span>`
    : escapeHtml(item.label)
  const desc = item.description
    ? `<small>${escapeHtml(item.description)}</small>`
    : ''
  return `<a ${anchorAttrs(item, origin)}>${label}${desc}</a>`
}

function navGroup(
  label: string,
  items: NavItem[],
  grid: boolean,
  origin: string
): string {
  return (
    `<div class="nav-group">` +
    `<button type="button" class="nav-trigger" aria-haspopup="true" aria-expanded="false">${label} ${CHEVRON}</button>` +
    `<div class="nav-menu${grid ? ' nav-menu-grid' : ''}">${items
      .map((item) => menuAnchor(item, origin))
      .join('')}</div>` +
    `</div>`
  )
}

/** Inner markup for `<nav class="nav-links">` — both dropdowns plus the
 * top-level links, in the same order as the landing header. */
export function renderNavLinks(origin: string): string {
  const top = TOP_LEVEL_LINKS.map(
    (item) => `<a ${anchorAttrs(item, origin)}>${escapeHtml(item.label)}</a>`
  ).join('')
  return (
    navGroup('Features', FEATURE_MENU, true, origin) +
    top +
    navGroup('Resources', RESOURCE_MENU, false, origin)
  )
}

/** Flat `<a>` list for the mobile drawer body (groups flattened — every
 * destination in tap order). */
export function renderNavDrawerLinks(origin: string): string {
  return [...FEATURE_MENU, ...TOP_LEVEL_LINKS, ...RESOURCE_DRAWER_ITEMS]
    .map(
      (item) =>
        `<a ${anchorAttrs(item, origin)}>${escapeHtml(item.label)}${badgeHtml(item)}</a>`
    )
    .join('')
}
