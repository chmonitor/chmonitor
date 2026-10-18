import type { SourceEngine } from '@chm/types'
import type { Icon } from '@chm/types/icon'
import type { FeaturePermission } from '@/lib/feature-permissions/types'
import type { BadgeVariant } from '@/types/badge-variant'

export type MenuSection = 'main' | 'others' | 'footer'

export interface MenuItem {
  title: string
  href: string
  description?: string
  /**
   * Group rows only: the hub landing page for this group (e.g.
   * `/hub/queries`). The sidebar heading label links here while the chevron
   * still expands, and the breadcrumb's group crumb links here. Kept apart
   * from `href`, which stays `''` on groups: every nav surface keys groups
   * by an empty href, and a real href would make the parent-path active rule
   * light the group up on unrelated pages.
   */
  hubHref?: string
  /**
   * Child rows of a hub group: the hub section this page is listed under
   * (e.g. "Live", "History"). Hub sections are derived from this field in
   * declaration order (lib/menu/hub.ts), so the hub never keeps its own list.
   */
  subgroup?: string
  /** Key for fetching count from /api/v1/menu-counts/[key] */
  countKey?: string
  /** Label shown on hover (e.g., "running", "merges", "tables") */
  countLabel?: string
  countVariant?: BadgeVariant
  items?: MenuItem[]
  icon?: Icon
  /** `footer` items render in AppSidebar, not NavMain. */
  section?: MenuSection
  /**
   * Extra Cmd+K aliases. The live palette matches `title`, `href`,
   * `description`, and these keywords (see `menuItemPaletteValue`).
   */
  keywords?: readonly string[]
  /** Show "New" badge - hidden after user visits the page */
  isNew?: boolean
  /** Link to ClickHouse documentation for this feature */
  docs?: string
  /** Feature gate metadata for deployment-level permissions */
  permission?: FeaturePermission
  /** ClickHouse system table name(s) to check for availability/muting */
  tableCheck?: string | string[]
  /**
   * Needs a state backend (D1, ClickHouse state, or Postgres). Without one the
   * item is dimmed, not hidden, so the operator can still find the feature
   * they are about to enable.
   */
  requiresMetadataDb?: boolean
  /**
   * A missing `tableCheck` table can never work on this host, so it hides by
   * default; a config gate can be turned on, so it dims by default. This
   * overrides either default (see `lib/menu/unavailable-visibility.ts`).
   */
  hideWhenUnavailable?: boolean
  /** Hidden in self-host. Filtered centrally by `getVisibleMenuItems`. */
  cloudOnly?: boolean
  /**
   * Absent means the ClickHouse family (`clickhouse` + `clickhouse-cloud`).
   * Filtered by `getVisibleMenuItems` against the active host's engine.
   */
  engines?: SourceEngine[]
}
