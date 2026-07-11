/**
 * Tool assembler — imports the kept category modules and composes the tool set.
 *
 * The agent intentionally exposes a small set of powerful primitives. Anything
 * not covered by a primitive is done with the `query` tool plus a `load_skill`
 * recipe (see .agents/skills/). Each category file exports a factory that
 * returns its tools for a given host.
 */

import { createAdvisorTools } from './advisor-tools'
import { createAskUserTools } from './ask-user-tools'
import { createControlTools } from './control-tools'
import { createDashboardTools } from './dashboard-tools'
import { createHealthTools } from './health-tools'
import { createInsightTools } from './insight-tools'
import { createMergeTools } from './merge-tools'
import { createMvDesignerTools } from './mv-designer-tools'
import { createPlanTools } from './plan-tools'
import { createPostgresHealthTools } from './postgres-health-tools'
import { createPostgresQueryTools } from './postgres-query-tools'
import { createPostgresTableTools } from './postgres-table-tools'
import { createQueryTools } from './query-tools'
import { createReferenceQueryTools } from './reference-query-tools'
import { createReplicationTools } from './replication-tools'
import { createSchemaTools } from './schema-tools'
import { createSkillTools } from './skill-tools'
import { createStorageTools } from './storage-tools'
import { createVisualizationTools } from './visualization-tools'

/**
 * Create all agent tools for a given host.
 *
 * Lean primitive set:
 *  - Schema & exploration: query, list_databases, list_tables,
 *    get_table_schema, explore_table_schema
 *  - Query analysis: get_running_queries, get_slow_queries,
 *    get_failed_queries, explain_query, estimate_query_cost,
 *    list_slow_query_patterns
 *  - Health: get_metrics, get_disk_usage
 *  - Storage: get_table_parts
 *  - Replication: get_replication_status
 *  - Merges: get_merge_status
 *  - Planning: update_plan
 *  - Knowledge: load_skill, find_reference_query
 *  - Interaction: ask_user
 *  - Visualization: query_and_visualize
 *  - Insights: explain_anomaly_score
 *  - Advisor: get_optimization_recommendations
 *  - Advisor: recommend_materialized_view
 *  - Dashboards: suggest_dashboard
 *  - Control (destructive, env-gated): kill_query, optimize_table, kill_mutation
 *  - Postgres (cross-source, env-gated): run_postgres_select_query,
 *    get_postgres_metrics, list_postgres_slow_query_patterns,
 *    get_postgres_table_stats
 */
export function createAllTools(hostId: number, includeControlTools = false) {
  const enableControlTools = process.env.AGENT_ENABLE_CONTROL_TOOLS === 'true'
  // Postgres cross-source tools stay ABSENT (not merely failing) unless the
  // source engine is enabled — a pure env gate, no Clerk, so OSS has equal
  // support. Server reads the canonical CHM_* name (VITE_* is the client mirror).
  const enablePostgresTools = process.env.CHM_FEATURE_POSTGRES_SOURCE === 'true'

  return {
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

    // User interaction
    ...createAskUserTools(),

    // Visualization
    ...createVisualizationTools(hostId),

    // Insights (statistical anomaly baselines)
    ...createInsightTools(hostId),

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
  }
}
