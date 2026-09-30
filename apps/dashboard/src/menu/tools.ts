import { DashboardIcon, InfoCircledIcon } from '@radix-ui/react-icons'
import {
  GitCompareArrowsIcon,
  SparklesIcon,
  TerminalIcon,
  UnplugIcon,
  WandSparklesIcon,
  WrenchIcon,
} from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const toolsItems: MenuItem[] = [
  {
    // Interactive utilities (ask the agent, run SQL, explain, compare, build
    // charts, expose MCP) — not system-table monitors. No `permission` on the
    // parent: children keep their own feature gates (`agent`, `tables`,
    // `queries`, `dashboard`, `settings`, `mcp`) so the group is not
    // over-gated.
    //
    // No `engines` on the parent or children (#3105 / #3115): absent already
    // means the default source-engine family. filterMenuItemsByEngine drops
    // the parent when itemMatchesEngine fails, so a Postgres host does not
    // see the group at all — not an empty heading, not CH-only children. Do
    // NOT add `engines: ['postgres']` (that would show these pages on a
    // Postgres host). Settings > Navigation uses the same
    // getSettingsNavMenuItems(engine) path as the sidebar.
    title: 'Tools & AI',
    href: '',
    icon: WrenchIcon,
    section: 'main',
    items: [
      {
        title: 'Chat',
        href: '/agents',
        description: 'Ask questions about this cluster in natural language',
        icon: SparklesIcon,
        isNew: true,
        // The chat UI renders for everyone; the backend enforces auth on send
        // (see AgentAuthGate / the /api/v1/agent route), not the client route
        // gate.
        permission: { feature: 'agent' },
      },
      {
        title: 'SQL Console',
        href: '/sql',
        description:
          'Run read-only SQL with history, EXPLAIN, query log and scan analysis',
        icon: TerminalIcon,
        docs: 'https://clickhouse.com/docs/en/sql-reference/statements/select', // pragma: allowlist secret
        permission: { feature: 'tables' },
      },
      {
        title: 'Explain',
        href: '/explain',
        description: 'Query execution plan analysis for performance tuning',
        icon: InfoCircledIcon,
        docs: 'https://clickhouse.com/docs/en/sql-reference/statements/explain', // pragma: allowlist secret
        permission: { feature: 'queries' },
      },
      {
        title: 'Advisor',
        href: '/advisor',
        description:
          'Ranked query, schema, TTL/partition, engine, and Distributed recommendations (recommend-only)',
        icon: WandSparklesIcon,
        isNew: true,
        keywords: [
          'query advisor',
          'schema advisor',
          'tuning',
          'skip index',
          'ttl',
          'partition',
          'distributed',
          'order by',
          'schema lint',
        ],
        permission: { feature: 'queries' },
      },
      {
        title: 'Chart Builder',
        href: '/dashboard',
        description: 'Build custom monitoring dashboards with charts', // pragma: allowlist secret
        icon: DashboardIcon,
        permission: { feature: 'dashboard' },
      },
      {
        title: 'Schema Compare',
        href: '/schema-diff',
        description:
          'Compare table schemas across hosts or cluster nodes and copy a recommend-only change plan',
        icon: GitCompareArrowsIcon,
        isNew: true,
        keywords: [
          'schema diff',
          'ddl',
          'sync',
          'compare hosts',
          'create table',
          'schema-diff',
        ],
        permission: { feature: 'settings' },
        tableCheck: 'system.tables',
      },
      {
        title: 'Settings Diff',
        href: '/settings-diff',
        description:
          'Compare system.settings and merge_tree_settings across saved hosts or cluster nodes',
        icon: GitCompareArrowsIcon,
        isNew: true,
        keywords: [
          'settings compare',
          'config diff',
          'merge_tree_settings',
          'settings-diff',
        ],
        permission: { feature: 'settings' },
      },
      {
        title: 'MCP Server',
        href: '/mcp',
        description:
          "Let external AI tools (Claude Desktop, Cursor, etc.) query this cluster via this dashboard's own MCP endpoint",
        icon: UnplugIcon,
        permission: { feature: 'mcp' },
      },
    ],
  },
]
