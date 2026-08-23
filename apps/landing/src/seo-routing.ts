/** First-path-segment dashboard routes that used to live on chmonitor.dev. */
export const DASHBOARD_PREFIXES = new Set([
  'about',
  'advisor',
  'agents',
  'ai-chat',
  'alert-settings',
  'asynchronous-inserts',
  'asynchronous-metrics',
  'background-schedule-pool',
  'backups',
  'blob-storage-log',
  'charts',
  'cluster',
  'clusters',
  'common-errors',
  'dashboard',
  'detached-parts',
  'device',
  'dictionaries',
  'disks',
  'distributed-ddl-queue',
  'dropped-tables',
  'errors',
  'expensive-queries',
  'expensive-queries-by-memory',
  'explain',
  'explorer',
  'failed-queries',
  'fleet',
  'health',
  'health-settings',
  'histogram-metrics',
  'history-queries',
  'inbound-events',
  'index-analytics',
  'insights',
  'insights-settings',
  'kafka-consumers',
  'keeper',
  'login',
  'logs',
  'mcp',
  'mcp-servers',
  'merge-performance',
  'merges',
  'mergetree-settings',
  'metrics',
  'moves',
  'mutations',
  'opentelemetry-spans',
  'overview',
  'page-views',
  'part-info',
  'part-log',
  'peerdb',
  'postgres',
  'profiler',
  'projections',
  'queries',
  'query',
  'query-cache',
  'query-condition-cache',
  'query-metric-log',
  'query-views-log',
  'rabbitmq-consumers',
  'readonly-tables',
  'recent-queries',
  'replicas',
  'replicated-fetches',
  'replicated-merge-tree-settings',
  'replication-queue',
  'report-settings',
  'roles',
  'running-queries',
  'schema-diff',
  'security',
  'settings',
  'settings-diff',
  'setup',
  'sign-in',
  'sign-up',
  'slow-queries',
  'slow-query-patterns',
  'sql',
  'storage-economics',
  'table',
  'tables',
  'tables-overview',
  'top-cpu-queries',
  'top-memory-queries',
  'top-usage-columns',
  'top-usage-tables',
  'traffic',
  'ttl-partition-health',
  'user-processes',
  'users',
  'view-refreshes',
  'warnings',
  'workload-scheduling',
  'zookeeper',
])

const DASH_ORIGIN = 'https://dash.chmonitor.dev'
const DOCS_ORIGIN = 'https://docs.chmonitor.dev'
const BLOG_ORIGIN = 'https://blog.chmonitor.dev'

export function firstSegment(pathname: string): string {
  return pathname.split('/').filter(Boolean)[0] ?? ''
}

export function stripTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/, '')
  }
  return pathname
}

export function shouldNoindexHost(hostname: string): boolean {
  return hostname.startsWith('preview.') || hostname.endsWith('.workers.dev')
}

export function previewRobotsTxt(): string {
  return `# Preview deployments are not the canonical site.
User-agent: *
Disallow: /
`
}

/** Absolute 301 target, or null to serve the landing asset. */
export function landingRedirectUrl(url: URL): string | null {
  const path = stripTrailingSlash(url.pathname)
  const first = firstSegment(path)
  const search = url.search

  if (first === 'docs') {
    const rest = path.replace(/^\/docs\/?/, '/')
    const dest = rest === '/' ? DOCS_ORIGIN : `${DOCS_ORIGIN}${rest}`
    return `${dest}${search}`
  }
  if (first === 'v0.3') {
    return `${BLOG_ORIGIN}${path}${search}`
  }
  if (DASHBOARD_PREFIXES.has(first)) {
    return `${DASH_ORIGIN}${path}${search}`
  }
  if (path !== url.pathname) {
    return `${url.origin}${path}${search}`
  }
  return null
}
