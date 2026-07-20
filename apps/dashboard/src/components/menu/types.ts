import type { SourceEngine } from '@chm/types'
import type { Icon } from '@chm/types/icon'
import type { FeaturePermission } from '@/lib/feature-permissions/types'
import type { BadgeVariant } from '@/types/badge-variant'

export type MenuSection = 'main' | 'others' | 'footer'

export interface MenuItem {
  title: string
  href: string
  description?: string
  /** Key for fetching count from /api/v1/menu-counts/[key] */
  countKey?: string
  /** Label shown on hover (e.g., "running", "merges", "tables") */
  countLabel?: string
  countVariant?: BadgeVariant
  items?: MenuItem[]
  icon?: Icon
  /**
   * Section grouping for sidebar display. `main` / `others` render as labelled
   * groups in the sidebar body (NavMain); `footer` items render as compact rows
   * in the sidebar footer (AppSidebar), above the Docs link and user button.
   */
  section?: MenuSection
  /** Show "New" badge - hidden after user visits the page */
  isNew?: boolean
  /** Link to ClickHouse documentation for this feature */
  docs?: string
  /** Feature gate metadata for deployment-level permissions */
  permission?: FeaturePermission
  /** ClickHouse system table name(s) to check for availability/muting */
  tableCheck?: string | string[]
  /**
   * Page needs the deployment's metadata database (D1 or Postgres) to persist
   * its state (e.g. report subscriptions). When none is configured the item is
   * dimmed — same treatment as a missing `tableCheck` table — never hidden, so
   * the OSS UX surface stays intact. Resolved via `config.metadataDb.available`
   * from `/api/v1/config` (see lib/menu/metadata-db.ts).
   */
  requiresMetadataDb?: boolean
  /**
   * Cloud (SaaS)-only surface — hidden in self-host / OSS. Set on items that
   * make sense only in the cloud product (e.g. Billing, Organization). Filtered
   * centrally by `getVisibleMenuItems` (lib/menu/visible-items.ts) against
   * `isCloudModeClient()`, so every nav surface (sidebar, command palette, …)
   * honors it without each one re-implementing the gate.
   */
  cloudOnly?: boolean
  /**
   * Source engines this item applies to (issue #2450 — engine-aware menu swap,
   * decision 4). ABSENT means the ClickHouse family (`clickhouse` +
   * `clickhouse-cloud`) — i.e. every existing item is unchanged. Postgres-only
   * items declare `engines: ['postgres']`. Filtered centrally by
   * `getVisibleMenuItems` against the ACTIVE host's engine, so switching to a
   * Postgres source swaps the nav menu to Postgres pages while ClickHouse hosts
   * keep today's exact menu (zero-diff invariant).
   */
  engines?: SourceEngine[]
}
