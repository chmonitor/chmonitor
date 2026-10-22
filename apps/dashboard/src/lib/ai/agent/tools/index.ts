import {
  type AgentConnectionBinding,
  bindToolsToConnection,
} from '../host-query'
import { createAdvisorTools } from './advisor-tools'
import { createAskUserTools } from './ask-user-tools'
import { createSearchTools } from './catalog-tools'
import { createControlTools } from './control-tools'
import { createDashboardTools } from './dashboard-tools'
import { createDetachedPartsTools } from './detached-parts-tools'
import { createDocsLookupTools } from './docs-lookup-tools'
import { createHealthTools } from './health-tools'
import { createInsightTools } from './insight-tools'
import { createMergeTools } from './merge-tools'
import { createMvDesignerTools } from './mv-designer-tools'
import { createPageDataTools } from './page-data-tools'
import { createPeerDBTools } from './peerdb-tools'
import { createPlanTools } from './plan-tools'
import { createPostgresHealthTools } from './postgres-health-tools'
import { createPostgresQueryTools } from './postgres-query-tools'
import { createPostgresTableTools } from './postgres-table-tools'
import { createQueryTools } from './query-tools'
import { createReferenceQueryTools } from './reference-query-tools'
import { createReplicationTools } from './replication-tools'
import { createReportTools } from './report-tools'
import { createSchemaTools } from './schema-tools'
import { createSkillTools } from './skill-tools'
import { createStorageTools } from './storage-tools'
import { createUsageTools } from './usage-tools'
import { createVisualizationTools } from './visualization-tools'
import { parseBool } from '@/lib/config/parse-bool'

/**
 * Tools that cannot run on a user's own connection yet:
 * - `explain_anomaly_score`, `generate_cluster_report`: their stores (anomaly
 *   baselines, insights) are keyed by host id alone, and every user's first
 *   connection shares id -1000, so reading them would mix users.
 * - `forecast_disk_capacity`, `suggest_ttl_adjustment`: they gate on
 *   `checkTableExists(hostId, …)` from `@chm/clickhouse-client`, which probes
 *   the ENV host list and caches by host id. On a connection it would wrongly
 *   answer "enable part_log".
 * - control tools: writes stay on env hosts.
 */
export const CONNECTION_UNSUPPORTED_TOOLS: ReadonlySet<string> = new Set([
  'explain_anomaly_score',
  'generate_cluster_report',
  'forecast_disk_capacity',
  'suggest_ttl_adjustment',
  'kill_query',
  'optimize_table',
  'kill_mutation',
])

/**
 * Create all agent tools for a given host.
 *
 * **This docblock is documentation, not the source of truth.** The per-tool
 * inventory lives in `./catalog.ts` (`TOOL_CATALOG`), which
 * `__tests__/tool-catalog.test.ts` checks against `createAllTools()` on every
 * run. An earlier version of this comment was hand-maintained and had already
 * drifted, so the grouping below is kept deliberately coarse. To answer "which
 * tools exist", read the catalog or call `search_tools` — not this list.
 */
export function createAllTools(
  hostId: number,
  includeControlTools = false,
  /**
   * The signed-in user's own connection, resolved by the agent route. When
   * set, every tool call runs bound to it (see `host-query.ts`).
   */
  connection?: AgentConnectionBinding,
  /**
   * Read-only integration tools, decided by the caller with
   * resolveIntegrationToolsEnabled() (../integration-tools-gate.ts) — the
   * agent route probes reachability and pins the result per conversation.
   * Off when omitted.
   */
  integrations?: { peerdb?: boolean; postgres?: boolean },
  /**
   * The request's disabled tool names. Removed BEFORE `search_tools` is bound,
   * so discovery and `callable_tool_count` describe the map the model gets.
   */
  disabledTools: readonly string[] = []
) {
  if (connection && connection.hostId !== hostId) {
    throw new Error('Agent connection binding does not match hostId')
  }
  // The flags' explicit `false` (and CHM_FEATURE_PEERDB_ENABLED=false) are
  // re-checked here as hard kill switches for every caller; the resolver
  // already returns off for them. No Clerk involvement, so OSS has equal
  // support.
  const enablePostgresTools =
    integrations?.postgres === true &&
    parseBool(process.env.CHM_FEATURE_POSTGRES_SOURCE) !== false
  const enablePeerDBTools =
    integrations?.peerdb === true &&
    parseBool(process.env.CHM_FEATURE_PEERDB_AGENT) !== false &&
    parseBool(process.env.CHM_FEATURE_PEERDB_ENABLED) !== false

  const registered = {
    ...createSchemaTools(hostId),

    ...createQueryTools(hostId),

    ...createHealthTools(hostId),

    ...createStorageTools(hostId),

    ...createReplicationTools(hostId),

    ...createMergeTools(hostId),

    ...createPlanTools(),

    ...createSkillTools(),

    ...createReferenceQueryTools(),

    ...createDocsLookupTools(hostId),

    ...createPageDataTools(hostId),

    ...createAskUserTools(),

    ...createVisualizationTools(hostId),

    ...createInsightTools(hostId),

    ...createReportTools(hostId),

    ...createAdvisorTools(hostId),
    ...createUsageTools(hostId),
    ...createDetachedPartsTools(hostId),
    ...createMvDesignerTools(hostId),

    ...createDashboardTools(),

    // Control actions (destructive). The caller decides via
    // resolveControlToolsEnabled() (../control-tools-gate.ts) plus the
    // `actions` permission check; off when the argument is omitted. An explicit
    // AGENT_ENABLE_CONTROL_TOOLS=false is re-checked here as a hard kill
    // switch for every caller (the resolver already returns false for it).
    ...(includeControlTools &&
    parseBool(process.env.AGENT_ENABLE_CONTROL_TOOLS) !== false
      ? createControlTools(hostId)
      : {}),

    // Postgres cross-source tools — read-only, on when the caller's
    // integration gate says so. They take an explicit `pgHostId` per call, so no hostId is threaded here.
    ...(enablePostgresTools
      ? {
          ...createPostgresQueryTools(),
          ...createPostgresHealthTools(),
          ...createPostgresTableTools(),
        }
      : {}),

    // PeerDB mirror status + metrics — on when the caller's integration gate
    // says so (and the PeerDB feature itself is not disabled). Read-only: fleet/detail status, slot lag, CDC throughput,
    // snapshot progress, per-peer stats, fleet aggregates.
    ...(enablePeerDBTools ? createPeerDBTools() : {}),
  }

  const tools: Partial<typeof registered> = { ...registered }
  for (const name of disabledTools) {
    delete tools[name as keyof typeof registered]
  }

  // `search_tools` is added LAST, and bound to the post-`disabledTools` map, so
  // it can only ever advertise a tool that is actually callable this request —
  // the Postgres / PeerDB / control gates and `disabledTools` are inherited
  // rather than re-checked.
  // It is not a gate: the whole tool set is still sent (see catalog.ts).
  const all = { ...tools, ...createSearchTools(tools) }
  return connection
    ? bindToolsToConnection(all, connection, CONNECTION_UNSUPPORTED_TOOLS)
    : all
}
