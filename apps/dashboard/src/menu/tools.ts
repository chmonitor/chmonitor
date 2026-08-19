import { DashboardIcon, InfoCircledIcon } from '@radix-ui/react-icons'
import {
  GitCompareArrowsIcon,
  TableIcon,
  TerminalIcon,
  WandSparklesIcon,
  WrenchIcon,
} from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const toolsItems: MenuItem[] = [
  {
    // Interactive utilities (run SQL, explore schema, explain, compare,
    // build charts) — not system-table monitors. Composed last among main
    // groups in index.ts (after Logs, before About / System / Cluster /
    // Operations). No `permission` on the parent: children keep the
    // feature gates they inherited from their old groups (`tables`,
    // `queries`, `dashboard`, `settings`) so the group is not over-gated.
    //
    // No `engines` on the parent or children (#3105 / #3115): absent already
    // means the default source-engine family. filterMenuItemsByEngine drops
    // the parent when itemMatchesEngine fails, so a Postgres host does not
    // see the Tools group at all — not an empty heading, not CH-only
    // children. Do NOT add `engines: ['postgres']` (that would show these
    // pages on a Postgres host). Settings > Navigation uses the same
    // getSettingsNavMenuItems(engine) path as the sidebar.
    title: 'Tools',
    href: '',
    icon: WrenchIcon,
    section: 'main',
    items: [
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
        title: 'Data Explorer',
        href: '/explorer',
        description: 'Interactive database schema browser with metadata',
        countKey: 'tables-explorer',
        countLabel: 'tables',
        icon: TableIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/databases', // pragma: allowlist secret
        tableCheck: ['system.databases', 'system.tables'],
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
          'Ranked skip-index, projection, partition-key, and PREWHERE recommendations for a slow query (recommend-only)',
        icon: WandSparklesIcon,
        isNew: true,
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
        permission: { feature: 'settings' },
      },
    ],
  },
]
