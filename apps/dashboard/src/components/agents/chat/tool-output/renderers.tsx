'use client'

import { BarChart3Icon } from 'lucide-react'

import type { ComponentProps, ReactNode } from 'react'
import type { AgentDataSourcesProps } from '@/components/agents/agent-data-sources'
import type { AgentVisualizationProps } from '@/components/agents/agent-visualization'

import { QueryInsightsCard } from '../query-insights-card'
import { ResultTable } from './result-table'
import { AdvisorRecommendationsPanel } from '@/components/agents/advisor-recommendations-panel'
import { AgentDashboardSuggestion } from '@/components/agents/agent-dashboard-suggestion'
import { AgentDataSources } from '@/components/agents/agent-data-sources'
import {
  AgentIssuesPanel,
  QueryRepairPanel,
  TableDesignPanel,
} from '@/components/agents/agent-diagnostics'
import { AgentVisualization } from '@/components/agents/agent-visualization'
import {
  AgentWorkflowPlan,
  type WorkflowPlanStep,
} from '@/components/agents/agent-workflow-plan'
import { TuningFindingsPanel } from '@/components/agents/tuning-findings-panel'
import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { EmptyState } from '@/components/ui/empty-state'
import { isCloudModeClient } from '@/lib/cloud/cloud-mode'

function renderStructuredOutput(output: unknown): ReactNode {
  if (output == null) return null

  const outputObj = output as Record<string, unknown>

  // Query insights - rendered as stat cards
  if (
    outputObj.type === 'query_insights' &&
    Array.isArray(outputObj.highlights)
  ) {
    return (
      <QueryInsightsCard
        insights={
          output as ComponentProps<typeof QueryInsightsCard>['insights']
        }
      />
    )
  }

  // Skip heavy chart rendering in cloud mode to avoid resource limits.
  // Self-hosted (OSS) deployments always render the full visualization.
  // NOTE: this component is client-rendered, so the environment check must be
  // cloud-mode (build-time flag), not isCloudflareWorkers() — the latter reads
  // browser globals (caches is defined in every browser) and would wrongly
  // disable charts for every visitor.
  if (outputObj.type === 'visualization' && Array.isArray(outputObj.rows)) {
    if (isCloudModeClient()) {
      return (
        <div className="space-y-3">
          <EmptyState
            variant="no-data"
            compact
            icon={
              <BarChart3Icon
                className="size-8 text-muted-foreground/60"
                strokeWidth={1.5}
              />
            }
            title="Interactive charts disabled on Workers"
            description="Charts are disabled in this deployment to avoid resource limits. Use a Docker deployment for full chart support."
            action={{
              label: 'Deployment docs',
              onClick: () =>
                window.open(
                  'https://github.com/chmonitor/chmonitor/blob/main/docs/deployment.md',
                  '_blank',
                  'noopener,noreferrer'
                ),
            }}
          />
          <ResultTable rows={outputObj.rows as unknown[]} maxRows={100} />
        </div>
      )
    }
    return (
      <AgentVisualization
        title={outputObj.title as string | undefined}
        sql={outputObj.sql as string}
        rows={outputObj.rows as Record<string, unknown>[]}
        columns={outputObj.columns as string[]}
        rowCount={outputObj.rowCount as number}
        viz={outputObj.viz as AgentVisualizationProps['viz']}
      />
    )
  }

  if (outputObj.type === 'data_sources' && Array.isArray(outputObj.sources)) {
    return (
      <AgentDataSources
        searchTerm={outputObj.searchTerm as string}
        sources={outputObj.sources as AgentDataSourcesProps['sources']}
      />
    )
  }

  if (outputObj.type === 'workflow_plan' && Array.isArray(outputObj.steps)) {
    return (
      <AgentWorkflowPlan
        steps={outputObj.steps as WorkflowPlanStep[]}
        note={outputObj.note as string | undefined}
        workflow={outputObj.workflow as string | undefined}
        total={outputObj.total as number | undefined}
        completed={outputObj.completed as number | undefined}
      />
    )
  }

  if (
    outputObj.type === 'dashboard_suggestion' &&
    typeof outputObj.layout === 'object' &&
    outputObj.layout !== null
  ) {
    return (
      <AgentDashboardSuggestion
        request={outputObj.request as string}
        name={outputObj.name as string}
        layout={
          outputObj.layout as ComponentProps<
            typeof AgentDashboardSuggestion
          >['layout']
        }
        chartCount={outputObj.chartCount as number}
      />
    )
  }

  if (outputObj.type === 'agent_issues' && Array.isArray(outputObj.issues)) {
    return (
      <AgentIssuesPanel
        output={output as ComponentProps<typeof AgentIssuesPanel>['output']}
      />
    )
  }

  if (outputObj.type === 'query_repair') {
    return (
      <QueryRepairPanel
        output={output as ComponentProps<typeof QueryRepairPanel>['output']}
      />
    )
  }

  if (
    outputObj.type === 'table_design_recommendation' &&
    Array.isArray(outputObj.recommendations)
  ) {
    return (
      <TableDesignPanel
        output={output as ComponentProps<typeof TableDesignPanel>['output']}
      />
    )
  }

  if (
    outputObj.type === 'query_advisor_recommendations' &&
    Array.isArray(outputObj.recommendations)
  ) {
    return (
      <AdvisorRecommendationsPanel
        output={
          output as ComponentProps<typeof AdvisorRecommendationsPanel>['output']
        }
      />
    )
  }

  if (
    outputObj.type === 'schema_tuning_findings' &&
    Array.isArray(outputObj.findings)
  ) {
    return (
      <TuningFindingsPanel
        output={output as ComponentProps<typeof TuningFindingsPanel>['output']}
      />
    )
  }

  if (Array.isArray(output) && output.length > 0) {
    const firstItem = output[0]
    if (typeof firstItem === 'object' && firstItem !== null) {
      return <ResultTable rows={output} maxRows={100} />
    }
  }

  if (
    outputObj.chartData &&
    Array.isArray(outputObj.chartData) &&
    outputObj.chartData.length > 0
  ) {
    return renderLegacyChart(outputObj)
  }

  if (Array.isArray(outputObj.rows) && outputObj.rows.length > 0) {
    return <ResultTable rows={outputObj.rows as unknown[]} maxRows={100} />
  }

  // No structured renderer matched → let the caller decide (raw JSON is shown
  // via renderRawOutput, kept behind a collapsed "Response" disclosure).
  return null
}

/**
 * Legacy `{ chartData, chartType, ... }` tool payloads (area/bar/donut) routed
 * through the unified {@link AgentVisualization} card — the same chrome, tabs,
 * and chart primitives every other visualization uses. No SQL travels with these
 * payloads, so the Query tab hides itself. Replaces the retired
 * `AgentChartRenderer` duplicate path (issue #2805).
 */
function renderLegacyChart(outputObj: Record<string, unknown>): ReactNode {
  const rows = outputObj.chartData as Record<string, unknown>[]
  const xKey = (outputObj.xKey as string | undefined) ?? 'name'
  const yKey = (outputObj.yKey as string | undefined) ?? 'value'
  const categories = outputObj.categories as string[] | undefined
  const yKeys = categories && categories.length > 0 ? categories : [yKey]
  const legacyType =
    (outputObj.chartType as 'area' | 'bar' | 'donut' | undefined) ?? 'bar'
  const chartType: AgentVisualizationProps['viz']['chartType'] =
    legacyType === 'area' ? 'area' : legacyType === 'donut' ? 'pie' : 'bar_list'
  const columns = Array.from(
    new Set([xKey, ...yKeys, ...Object.keys(rows[0] ?? {})])
  )

  return (
    <AgentVisualization
      title={outputObj.chartTitle as string | undefined}
      rows={rows}
      columns={columns}
      rowCount={rows.length}
      viz={{
        chartType,
        xKey,
        yKeys,
        readable: outputObj.readable as
          | 'bytes'
          | 'duration'
          | 'number'
          | 'quantity'
          | undefined,
      }}
    />
  )
}

/**
 * Raw fallback: the tool output as a JSON / text blob. Rendered only when no
 * structured renderer matches, and kept behind a collapsed disclosure so it
 * never clutters the row.
 */
function renderRawOutput(output: unknown): ReactNode {
  const isText = typeof output === 'string'
  return (
    <CodeBlock
      code={isText ? (output as string) : JSON.stringify(output, null, 2)}
      language={isText ? 'text' : 'json'}
      className="max-h-48 overflow-auto text-xs"
    >
      <CodeBlockCopyButton />
    </CodeBlock>
  )
}

/**
 * Renders a tool output. Structured shapes (charts, tables, insight /
 * diagnostic cards) render richly; anything else falls back to the raw JSON
 * blob. `renderStructuredOutput` is the SINGLE source of truth for "is there a
 * rich render?" — callers that must distinguish rich vs. raw call it directly
 * (non-null ⇒ rich), so the render path and the disclosure decision never drift.
 */
export function renderToolOutput(output: unknown): ReactNode {
  return renderStructuredOutput(output) ?? renderRawOutput(output)
}

export { renderStructuredOutput, renderRawOutput }
