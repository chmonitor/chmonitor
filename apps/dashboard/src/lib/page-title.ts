/**
 * Document `<title>` (tab text) and Cmd+K search titles for dashboard routes.
 *
 * `DynamicTitle` writes `getPageTitle() | chmonitor`. The command palette
 * indexes `pageTitlesForHref()` so a search for the tab title (or the OG
 * headline when it differs) finds the same page as the sidebar label.
 *
 * Keep this file free of React / DOM imports so bun tests can import it.
 */

import { OG_PAGES } from './og'

/** Explicit tab titles. Wins over OG `headTitle` / `title` for `getPageTitle`. */
export const ROUTE_TITLE_MAP: Record<string, string> = {
  '/': 'Overview',
  '/overview': 'Overview',
  '/agents': 'AI Agent',
  '/agents/settings': 'Agent Settings',
  '/insights': 'Insights',
  '/health': 'Health',
  '/running-queries': 'Running Queries',
  '/history-queries': 'Query History',
  '/slow-queries': 'Slow Queries',
  '/failed-queries': 'Failed Queries',
  '/common-errors': 'Common Errors',
  '/expensive-queries': 'Expensive Queries (Time)',
  '/expensive-queries-by-memory': 'Expensive Queries (Memory)',
  '/query-cache': 'Query Cache',
  '/queries/parallelization': 'Query Parallelization',
  '/queries/thread-analysis': 'Query Thread Analysis',
  '/tables': 'Tables',
  '/tables-overview': 'Tables Overview',
  '/readonly-tables': 'Readonly Tables',
  '/dropped-tables': 'Dropped Tables',
  '/top-usage-tables': 'Top Usage Tables',
  '/top-usage-columns': 'Top Usage Columns',
  '/view-refreshes': 'View Refreshes',
  '/detached-parts': 'Detached Parts',
  '/part-info': 'Part Info',
  '/part-log': 'Part Log',
  '/merges': 'Merge Operations',
  '/moves': 'Part Moves',
  '/mutations': 'Replication Mutations',
  '/merge-performance': 'Merge Performance',
  '/replicas': 'Replicated Tables',
  '/replicated-fetches': 'Replicated Fetches',
  '/replication-queue': 'Replication Queue',
  '/keeper': 'Keeper',
  '/keeper/overview': 'Keeper Overview',
  '/keeper/connections': 'Keeper Connections',
  '/keeper/watches': 'Keeper Watches',
  '/keeper/connection-log': 'Keeper Connection Log',
  '/keeper/watches-log': 'Keeper Watches Log',
  '/keeper/info': 'Keeper Info',
  '/keeper/log': 'Keeper Log',
  '/disks': 'Disks',
  '/asynchronous-metrics': 'Asynchronous Metrics',
  '/metrics': 'Metrics',
  '/mergetree-settings': 'MergeTree Settings',
  '/replicated-merge-tree-settings': 'Replicated MergeTree Settings',
  '/backups': 'Backups',
  '/distributed-ddl-queue': 'Distributed DDL Queue',
  '/zookeeper': 'ZooKeeper',
  '/users': 'Users',
  '/roles': 'Roles',
  '/security/sessions': 'Sessions',
  '/security/login-attempts': 'Login Attempts',
  '/security/audit-log': 'Audit Log',
  '/logs/crashes': 'Crash Log',
  '/logs/stack-traces': 'Stack Traces',
  '/logs/text-log': 'Text Log',
  '/profiler': 'Query Profiler',
  '/settings': 'Settings',
  '/explorer': 'Database Explorer',
  '/peerdb': 'PeerDB',
  '/peerdb/mirror': 'PeerDB Mirror',
  '/peerdb/peer': 'PeerDB Peer',
  '/peerdb/peers': 'PeerDB Peers',
  '/sql': 'SQL Console',
  '/explain': 'Explain',
  '/advisor': 'Advisor',
  '/dashboard': 'Chart Builder',
  '/schema-diff': 'Schema Compare',
  '/settings-diff': 'Settings Diff',
  '/ttl-partition-health': 'TTL & Partition Health',
  '/storage-economics': 'Storage Economics',
}

function pathOnly(href: string): string {
  return href.split('?')[0] || href
}

function isPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function ogEntry(pathname: string) {
  return OG_PAGES[pathOnly(pathname).replace(/^\//, '')]
}

/** Unique document / OG titles for a menu href (no `chmonitor` suffix). */
export function pageTitlesForHref(href: string): string[] {
  const path = pathOnly(href)
  const titles: string[] = []
  const seen = new Set<string>()
  const add = (value?: string) => {
    const trimmed = value?.trim()
    if (!trimmed) return
    const key = trimmed.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    titles.push(trimmed)
  }
  add(ROUTE_TITLE_MAP[path])
  const og = ogEntry(path)
  if (og) {
    add(og.headTitle)
    add(og.title)
  }
  return titles
}

/**
 * Browser tab title for a pathname (without ` | chmonitor`).
 * Order: special detail routes, explicit map, OG `headTitle`/`title`,
 * then title-cased last path segment.
 */
export function getPageTitle(
  pathname: string,
  searchParams: URLSearchParams = new URLSearchParams()
): string {
  if (isPath(pathname, '/query')) {
    const queryId = searchParams.get('query_id')
    return queryId ? `Query Details (${queryId.slice(0, 8)})` : 'Query Details'
  }

  if (isPath(pathname, '/table')) {
    const database = searchParams.get('database')
    const table = searchParams.get('table')
    return database && table
      ? `Table Details (${database}.${table})`
      : 'Table Details'
  }

  if (ROUTE_TITLE_MAP[pathname]) {
    return ROUTE_TITLE_MAP[pathname]
  }

  const og = ogEntry(pathname)
  if (og) return og.headTitle ?? og.title

  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return 'Overview'

  const lastSegment = segments[segments.length - 1]
  return lastSegment
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
