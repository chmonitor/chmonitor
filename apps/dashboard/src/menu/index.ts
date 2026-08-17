import type { MenuItem } from '@/components/menu/types'

import { aboutItems } from './about'
import { aiAgentItems } from './ai-agent'
import { clusterItems } from './cluster'
import { healthItems } from './health'
import { inboundEventsItems } from './inbound-events'
import { insightsItems } from './insights'
import { keeperItems } from './keeper'
import { logsItems } from './logs'
import { mergesItems } from './merges'
import { metricsItems } from './metrics'
import { operationsItems } from './operations'
import { organizationItems } from './organization'
import { overviewItems } from './overview'
import { peerdbItems } from './peerdb'
import { postgresItems } from './postgres'
import { queriesItems } from './queries'
import { securityItems } from './security'
import { systemItems } from './system'
import { tablesItems } from './tables'

// Composed in the exact original menu.ts order — see each section file for
// the top-level group it holds. Keep this order when adding/removing
// sections: it drives the sidebar and command palette listing order.
export const menuItemsConfig: MenuItem[] = [
  ...overviewItems,
  ...postgresItems,
  ...aiAgentItems,
  ...insightsItems,
  ...healthItems,
  ...inboundEventsItems,
  ...queriesItems,
  ...tablesItems,
  ...mergesItems,
  ...metricsItems,
  ...keeperItems,
  ...peerdbItems,
  ...securityItems,
  ...logsItems,
  ...organizationItems,
  ...aboutItems,
  ...systemItems,
  ...clusterItems,
  ...operationsItems,
]
