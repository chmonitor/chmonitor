/**
 * Navigation commands for the command registry.
 * Call `registerNavCommands()` once at app startup to seed the registry with
 * all dashboard routes. The fleet route added by #1922 is included here.
 */

import { commandRegistry } from './command-registry'

const NAV_ROUTES = [
  {
    id: 'nav-overview',
    label: 'Overview',
    href: '/overview',
    keywords: ['home', 'dashboard', 'summary'],
  },
  {
    id: 'nav-queries',
    label: 'Running Queries',
    href: '/running-queries',
    keywords: ['live', 'active', 'processes'],
  },
  {
    id: 'nav-history',
    label: 'Query History',
    href: '/history-queries',
    keywords: ['past', 'log', 'query_log'],
  },
  {
    id: 'nav-failed',
    label: 'Failed Queries',
    href: '/failed-queries',
    keywords: ['errors', 'exceptions', 'broken'],
  },
  {
    id: 'nav-tables',
    label: 'Tables',
    href: '/tables',
    keywords: ['schema', 'database', 'columns'],
  },
  {
    id: 'nav-merges',
    label: 'Merges',
    href: '/merges',
    keywords: ['parts', 'background', 'mutations'],
  },
  {
    id: 'nav-clusters',
    label: 'Clusters',
    href: '/clusters',
    keywords: ['topology', 'nodes', 'shards', 'replicas'],
  },
  {
    id: 'nav-fleet',
    label: 'Fleet Overview',
    href: '/fleet',
    keywords: ['hosts', 'multi-cluster', 'health', 'all hosts'],
  },
  {
    id: 'nav-replicas',
    label: 'Replicas',
    href: '/replicas',
    keywords: ['replication', 'lag', 'table-replicas'],
  },
  {
    id: 'nav-disks',
    label: 'Disks',
    href: '/disks',
    keywords: ['storage', 'space', 'volumes'],
  },
  {
    id: 'nav-settings',
    label: 'Settings',
    href: '/settings',
    keywords: ['config', 'configuration', 'server'],
  },
  {
    id: 'nav-logs-text',
    label: 'Text Log',
    href: '/logs/text-log',
    keywords: ['logs', 'errors', 'warnings', 'text_log'],
  },
  {
    id: 'nav-logs-crashes',
    label: 'Crash Log',
    href: '/logs/crashes',
    keywords: ['crash', 'fatal', 'crash_log', 'signal'],
  },
  {
    id: 'nav-agents',
    label: 'AI Agent',
    href: '/agents',
    keywords: ['ai', 'chat', 'assistant', 'llm'],
  },
  {
    id: 'nav-agent-settings',
    label: 'Agent Settings',
    href: '/agents/settings',
    keywords: ['ai', 'mcp', 'model', 'skills', 'provider', 'settings'],
  },
] as const

/**
 * Register all navigation commands into the global registry.
 * Safe to call multiple times — the registry overwrites on duplicate ids.
 */
export function registerNavCommands(): void {
  for (const route of NAV_ROUTES) {
    commandRegistry.register({ ...route, group: 'navigation' })
  }
}
