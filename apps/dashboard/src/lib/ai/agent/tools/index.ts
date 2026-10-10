/**
 * Tool assembler — imports the kept category modules and composes the tool set.
 *
 * The agent intentionally exposes a small set of powerful primitives. Anything
 * not covered by a primitive is done with the `query` tool plus a `load_skill`
 * recipe (see .agents/skills/). Each category file exports a factory that
 * returns its tools for a given host.
 */

import {
  type AgentConnectionBinding,
  bindToolsToConnection,
} from '../host-query'
import { createAdvisorTools } from './advisor-tools'
import { createAskUserTools } from './ask-user-tools'
import { createSearchTools } from './catalog-tools'
import { createControlTools } from './control-tools'
import { createDashboardTools } from './dashboard-tools'
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
 *
 * Lean primitive set:
 *  - Schema & exploration: query, list_databases, list_tables,
 *    get_table_schema, explore_table_schema
 *  - Query analysis: get_running_queries, get_slow_queries,
 *    get_failed_queries, explain_query, estimate_query_cost,
 *    list_slow_query_patterns
 *  - Health: get_metrics, get_disk_usage
 *  - Storage: get_table_parts, estimate_mutation_impact,
 *    forecast_disk_capacity, suggest_ttl_adjustment
 *  - Replication: get_replication_status
 *  - Merges: get_merge_status
 *  - Planning: update_plan
 *  - Knowledge: load_skill, find_reference_query
 *  - Interaction: ask_user
 *  - Visualization: query_and_visualize
 *  - Insights: explain_anomaly_score
 *  - Reports: generate_cluster_report
 *  - Advisor: get_optimization_recommendations, get_tuning_suggestions
 *  - Advisor: recommend_materialized_view
 *  - Dashboards: suggest_dashboard
 *  - Control (destructive, env-gated): kill_query, optimize_table, kill_mutation
 *  - Postgres (cross-source, env-gated): run_postgres_select_query,
 *    get_postgres_metrics, list_postgres_slow_query_patterns,
 *    get_postgres_table_stats
 *  - PeerDB (env-gated): get_peerdb_mirror_status, get_peerdb_metrics
 *  - Discovery (always): search_tools
 */
export function createAllTools(
  hostId: number,
  includeControlTools = false,
  /**
   * The signed-in user's own connection, resolved by the agent route. When
   * set, every tool call runs bound to it (see `host-query.ts`).
   */
  connection?: AgentConnectionBinding
) {
  if (connection && connection.hostId !== hostId) {
    throw new Error('Agent connection binding does not match hostId')
  }
  const enableControlTools =
    parseBool(process.env.AGENT_ENABLE_CONTROL_TOOLS) === true
  // Postgres cross-source tools stay ABSENT (not merely failing) unless the
  // source engine is enabled — a pure env gate, no Clerk, so OSS has equal
  // support. Server reads the canonical CHM_* name (VITE_* is the client mirror).
  const enablePostgresTools =
    parseBool(process.env.CHM_FEATURE_POSTGRES_SOURCE) === true
  // PeerDB mirror-status tool — explicit opt-in (a URL-presence gate would
  // silently advertise PeerDB reads to the model on every deployment whose
  // operator only wanted the UI section). Execution still fail-closes when
  // PEERDB_API_URL is unset. No Clerk involvement, so OSS has equal support.
  const enablePeerDBTools =
    parseBool(process.env.CHM_FEATURE_PEERDB_AGENT) === true &&
    parseBool(process.env.CHM_FEATURE_PEERDB_ENABLED) !== false

  const tools = {
    // Schema & exploration
    ...createSchemaTools(hostId),

    // Query analysis
    ...createQueryTools(hostId),

    // System health
    ...createHealthTools(hostId),

    // Storage & parts
    ...createStorageTools(hostId),

    // Replication
    ...createReplicationTools(hostId),

    // Merges
    ...createMergeTools(hostId),

    // Plan & verify
    ...createPlanTools(),

    // Skills / knowledge
    ...createSkillTools(),

    // Reference-query retrieval (built-in QueryConfig catalog, read-only)
    ...createReferenceQueryTools(),

    // Page data (replays a dashboard page's own table + chart queries, read-only)
    ...createPageDataTools(hostId),

    // User interaction
    ...createAskUserTools(),

    // Visualization
    ...createVisualizationTools(hostId),

    // Insights (statistical anomaly baselines)
    ...createInsightTools(hostId),

    // Reports (deterministic health report for agent narration, read-only)
    ...createReportTools(hostId),

    // Advisor (ranked DDL/rewrite recommendations — recommend-only)
    ...createAdvisorTools(hostId),
    // Advisor (MV/projection designer, recommend-only)
    ...createMvDesignerTools(hostId),

    // Dashboards (AI-generated layout suggestions, recommend-only)
    ...createDashboardTools(),

    // Control actions (destructive) — off unless explicitly enabled
    ...(enableControlTools && includeControlTools
      ? createControlTools(hostId)
      : {}),

    // Postgres cross-source tools — off unless CHM_FEATURE_POSTGRES_SOURCE=true.
    // They take an explicit `pgHostId` per call, so no hostId is threaded here.
    ...(enablePostgresTools
      ? {
          ...createPostgresQueryTools(),
          ...createPostgresHealthTools(),
          ...createPostgresTableTools(),
        }
      : {}),

    // PeerDB mirror status + metrics — off unless
    // CHM_FEATURE_PEERDB_AGENT=true (and the PeerDB feature itself is not
    // disabled). Read-only: fleet/detail status, slot lag, CDC throughput,
    // snapshot progress, per-peer stats, fleet aggregates.
    ...(enablePeerDBTools ? createPeerDBTools() : {}),
  }

  // `search_tools` is added LAST, and bound to the map built above, so it can
  // only ever advertise a tool that is actually registered this request — the
  // Postgres / PeerDB / control gates are inherited rather than re-checked.
  // It is not a gate: the whole tool set is still sent (see catalog.ts).
  const all = { ...tools, ...createSearchTools(tools) }
  return connection
    ? bindToolsToConnection(all, connection, CONNECTION_UNSUPPORTED_TOOLS)
    : all
}
