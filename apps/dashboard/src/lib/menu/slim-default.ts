import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

/**
 * Essential first-run sidebar keep list. Taken from the live catalog —
 * existing pages only, no new product areas.
 *
 * Fresh profiles hide every other default-engine leaf. Postgres-only leaves
 * are never on the hide list (engine swap already drops those groups).
 * Footer rows are never hidden.
 *
 * Groups stay grouped on the live rail. First-run keep list is the day-to-day
 * pages: Overview (leaf); AI Agent → Chat; Insights → Insights; Health →
 * Health; Queries → Running; Tables → Overview + Explorer; Merges → Merges;
 * Metrics → Metrics; Tools → SQL + Explain + Advisor (Explorer also lists
 * under Tools); Cluster → Clusters. Hover + still nests hidden siblings.
 * Group headings open a per-category customize dialog.
 *
 * Full in Settings → Navigation still shows every page. Keeper / PeerDB /
 * Security / Logs / System / Operations stay off first-run. New pages that
 * should stay off the default rail must not be added here.
 *
 * DBA / Engineer / SRE remain group-title presets (not leaf keep-lists).
 */
export const DEFAULT_VISIBLE_MENU_HREFS = [
  '/overview',
  '/agents',
  '/insights',
  '/health',
  '/running-queries',
  '/tables-overview',
  '/explorer',
  '/merges',
  '/metrics',
  '/sql',
  '/explain',
  '/advisor',
  '/clusters',
] as const

const VISIBLE = new Set<string>(DEFAULT_VISIBLE_MENU_HREFS)

function isPostgresOnly(item: MenuItem): boolean {
  const engines = item.engines
  if (!engines?.length) return false
  return engines.every((engine) => engine === 'postgres')
}

function isFooterItem(item: MenuItem): boolean {
  return item.section === 'footer'
}

function collectHideableLeaves(
  items: readonly MenuItem[],
  out: MenuItem[] = []
): MenuItem[] {
  for (const item of items) {
    if (isFooterItem(item) || isPostgresOnly(item)) continue
    if (item.items?.length) {
      collectHideableLeaves(item.items, out)
      continue
    }
    if (item.href) out.push(item)
  }
  return out
}

/**
 * Hide list for the Essential first-run default. Complementary to
 * {@link DEFAULT_VISIBLE_MENU_HREFS} over the current menu catalog.
 * Hide = sidebar / More membership only — not the command palette.
 */
export const DEFAULT_HIDDEN_MENU_HREFS: string[] = collectHideableLeaves(
  menuItemsConfig
)
  .map((item) => item.href)
  .filter((href) => !VISIBLE.has(href))
