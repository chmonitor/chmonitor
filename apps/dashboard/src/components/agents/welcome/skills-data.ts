/**
 * Skills bundle definitions for the AI Agent page.
 *
 * A "skill" is a bundle of related tools the agent can invoke. The
 * `source: 'system'` skills are always available; `community` skills can be
 * toggled off so the user (or operator) can prune the tool surface.
 */

import {
  ActivityIcon,
  CpuIcon,
  DatabaseIcon,
  GitMergeIcon,
  HardDriveIcon,
  type LucideIcon,
  SearchIcon,
  ShieldIcon,
  SquareStackIcon,
  TableIcon,
} from 'lucide-react'

export type SkillSource = 'system' | 'community'

export interface Skill {
  id: string
  name: string
  description: string
  icon: LucideIcon
  source: SkillSource
  tools: readonly string[]
  defaultEnabled: boolean
  /** Longer text shown in the skill detail dialog. */
  details?: string
}

export const SKILLS: readonly Skill[] = [
  {
    id: 'schema',
    name: 'Schema',
    description: 'Inspect databases, tables, columns, indexes',
    icon: TableIcon,
    source: 'system',
    tools: [
      'list_databases',
      'list_tables',
      'get_table_schema',
      'explore_table_schema',
    ],
    defaultEnabled: true,
    details:
      'Discover the shape of your cluster: list databases and tables, drill into column types, inspect skip indexes, and resolve constraints. Use it before writing queries to confirm naming and structure.',
  },
  {
    id: 'query',
    name: 'Query',
    description: 'Run, explain & optimize SQL on the cluster',
    icon: SearchIcon,
    source: 'system',
    tools: ['query', 'explain_query'],
    defaultEnabled: true,
    details:
      'Execute read-only SQL with proper parameterisation, analyse the plan for hot-spots and inefficient joins, and repair queries that hit known ClickHouse errors.',
  },
  {
    id: 'system',
    name: 'System',
    description: 'Read system tables — processes, metrics, settings',
    icon: ActivityIcon,
    source: 'system',
    tools: [
      'get_metrics',
      'get_running_queries',
      'get_slow_queries',
      'get_merge_status',
    ],
    defaultEnabled: true,
    details:
      'Pull operational data straight from ClickHouse system tables — running queries, slow query log, async metrics, merge progress — and surface anomalies that need a closer look.',
  },
  {
    id: 'resources',
    name: 'Resources',
    description: 'CPU, memory, disk & network telemetry',
    icon: CpuIcon,
    source: 'system',
    tools: ['get_metrics', 'get_running_queries'],
    defaultEnabled: true,
    details:
      'Track CPU saturation, memory pressure, disk usage and network throughput from system.metrics / asynchronous_metrics so you can correlate symptoms to load.',
  },
  {
    id: 'merges',
    name: 'Merges',
    description: 'Inspect & nudge MergeTree background ops',
    icon: GitMergeIcon,
    source: 'community',
    tools: ['get_merge_status'],
    defaultEnabled: true,
    details:
      'Inspect merge queues, spot stuck or oversized merges, and understand which background operations are consuming the merge pool.',
  },
  {
    id: 'storage',
    name: 'Storage',
    description: 'Disks, parts, retention & TTL analysis',
    icon: HardDriveIcon,
    source: 'community',
    tools: ['list_databases', 'list_tables', 'get_table_schema'],
    defaultEnabled: true,
    details:
      'Audit on-disk usage per table, count active parts, evaluate TTL effectiveness and surface tables that are about to outgrow their volume.',
  },
  {
    id: 'security',
    name: 'Security',
    description: 'Users, grants, row-level policies',
    icon: ShieldIcon,
    source: 'community',
    tools: ['get_metrics', 'list_databases'],
    defaultEnabled: true,
    details:
      'Review who can do what — users, roles, granted privileges, row policies and quotas — and highlight overly broad access.',
  },
  {
    id: 'replication',
    name: 'Replication',
    description: 'Replicas, ZK queue, sync lag',
    icon: SquareStackIcon,
    source: 'community',
    tools: ['get_metrics', 'list_databases', 'list_tables'],
    defaultEnabled: true,
    details:
      'Diagnose replicated tables: per-replica lag, ZooKeeper queue depth, readonly state, and sync issues that prevent writes from converging across the cluster.',
  },
] as const

export const SKILL_STORAGE_KEY = 'clickhouse-monitor-agent-skills'

export interface SkillState {
  /** Skill IDs that are explicitly turned off. */
  disabled: string[]
}

export function readSkillStorage(): SkillState {
  if (typeof window === 'undefined') return { disabled: [] }
  try {
    const raw = localStorage.getItem(SKILL_STORAGE_KEY)
    if (!raw) {
      return {
        disabled: SKILLS.filter((s) => !s.defaultEnabled).map((s) => s.id),
      }
    }
    const parsed = JSON.parse(raw) as SkillState
    return { disabled: Array.isArray(parsed.disabled) ? parsed.disabled : [] }
  } catch {
    return { disabled: [] }
  }
}

export function writeSkillStorage(state: SkillState): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SKILL_STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

export function countActiveTools(activeSkillIds: readonly string[]): number {
  const set = new Set<string>()
  for (const id of activeSkillIds) {
    const skill = SKILLS.find((s) => s.id === id)
    if (!skill) continue
    for (const t of skill.tools) set.add(t)
  }
  return set.size
}

/** All unique tool names across every skill (sorted for stable rendering). */
export function getAllSkillTools(): readonly string[] {
  const set = new Set<string>()
  for (const skill of SKILLS) {
    for (const tool of skill.tools) set.add(tool)
  }
  return [...set].sort()
}

/** Skill bundles that contain the given tool (one tool may live in multiple). */
export function getSkillsForTool(tool: string): readonly Skill[] {
  return SKILLS.filter((skill) => skill.tools.includes(tool))
}

export function getDatabaseIcon(): LucideIcon {
  return DatabaseIcon
}
