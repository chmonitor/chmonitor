import { useQuery } from '@tanstack/react-query'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from '@/lib/next-compat'
import { visibilityAwareInterval } from '@/lib/swr/config'

const BASE_TITLE = 'chmonitor'
const WARNING_PREFIX = '⚠️ '

interface HealthzResponse {
  ok: boolean
  hosts?: Array<{ status: 'up' | 'down' }>
}

const fetcher = async (url: string): Promise<HealthzResponse> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Healthz fetch failed: ${response.status}`)
  }
  return response.json() as Promise<HealthzResponse>
}

const ROUTE_TITLE_MAP: Record<string, string> = {
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
}

function getPageTitle(pathname: string, searchParams: URLSearchParams): string {
  if (pathname.startsWith('/query')) {
    const queryId = searchParams.get('query_id')
    return queryId ? `Query Details (${queryId.slice(0, 8)})` : 'Query Details'
  }

  if (pathname.startsWith('/table')) {
    const database = searchParams.get('database')
    const table = searchParams.get('table')
    return database && table
      ? `Table Details (${database}.${table})`
      : 'Table Details'
  }

  if (ROUTE_TITLE_MAP[pathname]) {
    return ROUTE_TITLE_MAP[pathname]
  }

  // Fallback: title-case the last segment of the pathname
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return 'Overview'

  const lastSegment = segments[segments.length - 1]
  return lastSegment
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Updates document.title dynamically based on active page route and health.
 * Polls /api/healthz every 60 seconds.
 */
export function DynamicTitle() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const { data } = useQuery<HealthzResponse>({
    queryKey: ['/api/healthz'],
    queryFn: () => fetcher('/api/healthz'),
    refetchInterval: visibilityAwareInterval(60_000),
    refetchOnWindowFocus: false,
    retry: 2,
  })

  useEffect(() => {
    const pageTitle = getPageTitle(
      pathname || '/',
      searchParams || new URLSearchParams()
    )
    const fullTitle = `${pageTitle} | ${BASE_TITLE}`
    const isDegraded = data?.ok === false

    document.title = isDegraded ? `${WARNING_PREFIX}${fullTitle}` : fullTitle

    return () => {
      document.title = `${pageTitle} | ${BASE_TITLE}`
    }
  }, [data, pathname, searchParams])

  return null
}
