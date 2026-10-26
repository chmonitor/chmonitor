import type { InsightCard } from '@/lib/insights/types'

/** How the admin applies ClickHouse server changes; decides where the fix goes. */
export type ConfigTarget =
  | 'config-files'
  | 'kubernetes-operator'
  | 'helm'
  | 'clickhouse-cloud'
  | 'sql-only'

export const CONFIG_TARGETS: Record<
  ConfigTarget,
  { label: string; guidance: string }
> = {
  'config-files': {
    label: 'Config files (config.d / users.d)',
    guidance:
      'Server settings live in XML or YAML overrides under /etc/clickhouse-server/config.d/ and users.d/. Add or edit an override file there; never edit config.xml itself. Say which changes need a server restart and which are picked up live.',
  },
  'kubernetes-operator': {
    label: 'Kubernetes operator (ClickHouseInstallation)',
    guidance:
      'The cluster is managed by the Altinity clickhouse-operator. Change the ClickHouseInstallation manifest (spec.configuration.settings, profiles, users or files) in the repo, not the pods. Note which changes trigger a rolling restart.',
  },
  helm: {
    label: 'Helm chart values',
    guidance:
      'The cluster is deployed with a Helm chart. Change values.yaml (or the environment overlay) in the repo and show the helm upgrade command; do not patch running pods. Note which changes trigger a rolling restart.',
  },
  'clickhouse-cloud': {
    label: 'ClickHouse Cloud',
    guidance:
      'This is ClickHouse Cloud: server config files are not editable. Use SQL (ALTER TABLE, CREATE/ALTER SETTINGS PROFILE, ALTER USER) or the Cloud console or API, and say when a setting is not available on Cloud.',
  },
  'sql-only': {
    label: 'SQL only (no config access)',
    guidance:
      'Only SQL access is available. Fix it with ALTER TABLE, settings profiles, users and grants, or query-level settings. If the real fix needs server config, say so and stop there.',
  },
}

export const DEFAULT_CONFIG_TARGET: ConfigTarget = 'config-files'

export interface ClusterSetup {
  target: ConfigTarget
  /** ClickHouse server version, empty when unknown. */
  version?: string
  /** Distinct nodes in system.clusters; 1 or missing means single node. */
  clusterNodes?: number
}

/**
 * A prompt an admin pastes into a coding agent (Claude Code, Codex, Cursor)
 * working in their infrastructure repo. It carries the finding and the setup,
 * and asks for a reviewed change rather than a direct production write.
 */
export function buildAgentPrompt(
  insight: Pick<
    InsightCard,
    'title' | 'detail' | 'severity' | 'category' | 'metric' | 'value'
  >,
  setup: ClusterSetup
): string {
  const nodes = setup.clusterNodes ?? 0
  const topology =
    nodes > 1
      ? `a cluster of ${nodes} nodes; apply the change to every replica and shard (ON CLUSTER for DDL, the same override on every node)`
      : 'a single node'
  const metric = insight.metric
    ? `\nMetric: ${insight.metric}${insight.value === undefined ? '' : ` = ${insight.value}`}`
    : ''

  return `You are helping me fix a ClickHouse issue found by chmonitor.

## Finding
Severity: ${insight.severity}
Category: ${insight.category}
Title: ${insight.title}${metric}

${insight.detail.trim()}

## My setup
- ClickHouse version: ${setup.version || 'unknown, check it with SELECT version()'}
- Topology: ${topology}
- How I apply changes: ${CONFIG_TARGETS[setup.target].label}

${CONFIG_TARGETS[setup.target].guidance}

## What to do
1. Confirm the finding first with read-only queries (system tables only) and show me what you ran.
2. Find the root cause and propose the smallest change that fixes it. Use only settings that exist in my ClickHouse version.
3. Make the change as a reviewable diff in this repo. Do not run anything that writes to the cluster yourself.
4. List how to verify the fix after I apply it, and how to roll it back.
5. If this finding is expected for my workload, say so and recommend no change.`
}
