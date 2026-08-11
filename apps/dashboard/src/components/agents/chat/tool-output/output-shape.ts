import type { QueryConfig } from '@/types/query-config'

export function createResultQueryConfig(
  columns: string[]
): QueryConfig<string[]> {
  return {
    name: 'agent-query-result',
    description: 'Query results from AI agent',
    sql: 'SELECT * FROM agent_result',
    columns,
  }
}

export function getRowsFromOutput(output: unknown): Record<string, unknown>[] {
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0]
    if (typeof first === 'object' && first !== null) {
      return output as Record<string, unknown>[]
    }
  }

  if (typeof output === 'object' && output !== null) {
    const obj = output as Record<string, unknown>
    if (Array.isArray(obj.rows) && obj.rows.length > 0) {
      return obj.rows as Record<string, unknown>[]
    }
  }

  return []
}

export function getPromotedOutputType(output: unknown) {
  if (typeof output !== 'object' || output === null) return null

  const outputObj = output as Record<string, unknown>
  if (
    outputObj.type === 'query_insights' &&
    Array.isArray(outputObj.highlights)
  ) {
    return 'query_insights' as const
  }
  if (outputObj.type === 'visualization' && Array.isArray(outputObj.rows)) {
    return 'visualization' as const
  }
  if (outputObj.type === 'data_sources' && Array.isArray(outputObj.sources)) {
    return 'data_sources' as const
  }
  if (outputObj.type === 'workflow_plan' && Array.isArray(outputObj.steps)) {
    return 'workflow_plan' as const
  }
  if (
    outputObj.type === 'dashboard_suggestion' &&
    typeof outputObj.layout === 'object' &&
    outputObj.layout !== null
  ) {
    return 'dashboard_suggestion' as const
  }
  if (outputObj.type === 'agent_issues' && Array.isArray(outputObj.issues)) {
    return 'agent_issues' as const
  }
  if (outputObj.type === 'query_repair') {
    return 'query_repair' as const
  }
  if (
    outputObj.type === 'table_design_recommendation' &&
    Array.isArray(outputObj.recommendations)
  ) {
    return 'table_design_recommendation' as const
  }

  return null
}
