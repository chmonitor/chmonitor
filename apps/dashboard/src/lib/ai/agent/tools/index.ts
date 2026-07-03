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
import { createHealthTools } from './health-tools'
import { createInsightTools } from './insight-tools'
import { createMergeTools } from './merge-tools'
import { createPlanTools } from './plan-tools'
import { createQueryTools } from './query-tools'
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
 *    get_failed_queries, explain_query
 *  - Health: get_metrics, get_disk_usage
 *  - Storage: get_table_parts
 *  - Replication: get_replication_status
 *  - Merges: get_merge_status
 *  - Planning: update_plan
 *  - Knowledge: load_skill
 *  - Interaction: ask_user
 *  - Visualization: query_and_visualize
 *  - Insights: explain_anomaly_score
 *  - Advisor: get_optimization_recommendations
 *  - Control (destructive, env-gated): kill_query, optimize_table, kill_mutation
 */
export function createAllTools(hostId: number, includeControlTools = false) {
  const enableControlTools = process.env.AGENT_ENABLE_CONTROL_TOOLS === 'true'

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

    // User interaction
    ...createAskUserTools(),

    // Visualization
    ...createVisualizationTools(hostId),

    // Insights (statistical anomaly baselines)
    ...createInsightTools(hostId),

    // Advisor (ranked DDL/rewrite recommendations — recommend-only)
    ...createAdvisorTools(hostId),

    // Control actions (destructive) — off unless explicitly enabled
    ...(enableControlTools && includeControlTools
      ? createControlTools(hostId)
      : {}),
  }
}
