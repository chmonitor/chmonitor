import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

/**
 * v1 day-to-day sidebar keep list (#3290). Taken from the live menu on
 * dash.chmonitor.dev — existing pages only, no new product areas.
 *
 * First-run / missing-workspace settings hide every other default-engine
 * leaf. Postgres-only leaves are never on the hide list (engine swap already
 * drops those groups). Footer rows are never hidden.
 *
 * Full in Settings → Navigation still shows every page. New pages that
 * should stay off the default rail must not be added here.
 */
export const DEFAULT_VISIBLE_MENU_HREFS = [
  '/overview',
  '/agents',
  '/insights',
  '/health',
  '/running-queries',
  '/tables',
  '/explorer',
  '/tables-overview',
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
 * Hide list for the slim first-run default. Complementary to
 * {@link DEFAULT_VISIBLE_MENU_HREFS} over the current menu catalog.
 */
export const DEFAULT_HIDDEN_MENU_HREFS: string[] = collectHideableLeaves(
  menuItemsConfig
)
  .map((item) => item.href)
  .filter((href) => !VISIBLE.has(href))
