import type { MenuItem } from '@/components/menu/types'

import { aboutItems } from './about'
import { aiAgentItems } from './ai-agent'
import { clusterItems } from './cluster'
import { healthItems } from './health'
import { insightsItems } from './insights'
import { keeperItems } from './keeper'
import { logsItems } from './logs'
import { mergesItems } from './merges'
import { metricsItems } from './metrics'
import { operationsItems } from './operations'
import { overviewItems } from './overview'
import { peerdbItems } from './peerdb'
import { postgresItems } from './postgres'
import { queriesItems } from './queries'
import { securityItems } from './security'
import { systemItems } from './system'
import { tablesItems } from './tables'
import { toolsItems } from './tools'

// Composed in sidebar / command-palette order — see each section file for
// the top-level group it holds. Keep this order when adding/removing
// sections. Tools is the last main-section group: after Logs, before the
// About footer and the others section (System / Cluster / Operations).
export const menuItemsConfig: MenuItem[] = [
  ...overviewItems,
  ...postgresItems,
  ...aiAgentItems,
  ...insightsItems,
  ...healthItems,
  ...queriesItems,
  ...tablesItems,
  ...mergesItems,
  ...metricsItems,
  ...keeperItems,
  ...peerdbItems,
  ...securityItems,
  ...logsItems,
  ...toolsItems,
  ...aboutItems,
  ...systemItems,
  ...clusterItems,
  ...operationsItems,
]
