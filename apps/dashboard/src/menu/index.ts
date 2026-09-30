import type { MenuItem } from '@/components/menu/types'

import { aboutItems } from './about'
import { alertsInsightsItems } from './alerts-insights'
import { clusterReplicationItems } from './cluster-replication'
import { dataStorageItems } from './data-storage'
import { overviewItems } from './overview'
import { postgresItems } from './postgres'
import { queriesItems } from './queries'
import { serverItems } from './server'
import { settingsItems } from './settings'
import { toolsItems } from './tools'

// Composed in sidebar / command-palette order: Overview, then the task groups
// (Queries → Data & Storage → Cluster & Replication → Server → Alerts &
// Insights → Tools & AI), then the About footer and the Settings group in the
// others section. Each task group is one level deep (group > page); the
// sidebar renderer does not recurse.
//
// Postgres items stay top-level: they carry `engines: ['postgres']`, and a
// ClickHouse-family parent would drop them on a Postgres host.
export const menuItemsConfig: MenuItem[] = [
  ...overviewItems,
  ...postgresItems,
  ...queriesItems,
  ...dataStorageItems,
  ...clusterReplicationItems,
  ...serverItems,
  ...alertsInsightsItems,
  ...toolsItems,
  ...aboutItems,
  ...settingsItems,
]
