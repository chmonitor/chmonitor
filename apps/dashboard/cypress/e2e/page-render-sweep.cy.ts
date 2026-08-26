/// <reference types="cypress" />

/**
 * Page-render sweep — visits every dashboard route with ?host=0 and asserts
 * the page shell renders without uncaught JS exceptions.
 *
 * This catches import errors, broken route configs, missing layout wrappers,
 * and module-level crashes that unit tests miss (they don't execute the
 * component tree against the real router). No ClickHouse data needed — the
 * pages should render their loading/error shells even without an API response.
 */

// All (dashboard) routes extracted from src/routes/(dashboard)/.
// Excludes layout helpers (prefixed with -) and the route.tsx layout file.
// Hardcoded so that adding a new route without updating this list fails the suite.
const DASHBOARD_ROUTES = [
  '/overview',
  '/dashboard',
  '/insights',
  '/about',
  '/advisor',
  '/agents',
  '/agents/settings',
  '/ai-chat',
  '/alert-settings',
  '/asynchronous-inserts',
  '/asynchronous-metrics',
  '/background-schedule-pool',
  '/backups',
  '/blob-storage-log',
  '/charts',
  '/cluster',
  '/clusters',
  '/clusters/replicas-status',
  '/common-errors',
  '/detached-parts',
  '/dictionaries',
  '/disks',
  '/distributed-ddl-queue',
  '/dropped-tables',
  '/errors',
  '/expensive-queries',
  '/expensive-queries-by-memory',
  '/explain',
  '/explorer',
  '/failed-queries',
  '/fleet',
  '/health',
  '/health-settings',
  '/histogram-metrics',
  '/history-queries',
  '/inbound-events',
  '/index-analytics',
  '/insights-settings',
  '/kafka-consumers',
  '/keeper',
  '/keeper/connection-log',
  '/keeper/connections',
  '/keeper/deep-dive',
  '/keeper/info',
  '/keeper/log',
  '/keeper/overview',
  '/keeper/watches',
  '/logs/crashes',
  '/logs/stack-traces',
  '/logs/text-log',
  '/mcp',
  '/mcp-servers',
  '/merge-performance',
  '/merges',
  '/mergetree-settings',
  '/metrics',
  '/moves',
  '/mutations',
  '/opentelemetry-spans',
  '/page-views',
  '/part-info',
  '/part-log',
  '/postgres/activity',
  '/postgres/queries',
  '/profiler',
  '/projections',
  '/queries/insights',
  '/queries/parallelization',
  '/queries/thread-analysis',
  '/query',
  '/query-cache',
  '/query-condition-cache',
  '/query-metric-log',
  '/query-views-log',
  '/rabbitmq-consumers',
  '/readonly-tables',
  '/recent-queries',
  '/replicas',
  '/replicated-fetches',
  '/replicated-merge-tree-settings',
  '/replication-queue',
  '/report-settings',
  '/roles',
  '/running-queries',
  '/schema-diff',
  '/security/audit-log',
  '/security/login-attempts',
  '/security/management',
  '/security/sessions',
  '/settings',
  '/settings-diff',
  '/setup',
  '/slow-queries',
  '/slow-query-patterns',
  '/sql',
  '/storage-economics',
  '/table',
  '/tables',
  '/tables-overview',
  '/top-cpu-queries',
  '/top-memory-queries',
  '/top-usage-columns',
  '/top-usage-tables',
  '/traffic',
  '/ttl-partition-health',
  '/user-processes',
  '/users',
  '/view-refreshes',
  '/warnings',
  '/workload-scheduling',
  '/zookeeper',
] as const

describe('Page render sweep', () => {
  const failedRoutes: string[] = []

  // Collect uncaught exceptions instead of failing immediately — we want to
  // report *all* broken routes in one go, not stop at the first one.
  Cypress.on('uncaught:exception', () => {
    // Return false to prevent Cypress from failing the test.
    // We track failures via the failedRoutes array instead.
    return false
  })

  after(() => {
    if (failedRoutes.length > 0) {
      throw new Error(
        `${failedRoutes.length} route(s) had render errors:\n${failedRoutes.map((r) => `  - ${r}`).join('\n')}`
      )
    }
  })

  for (const route of DASHBOARD_ROUTES) {
    it(`renders ${route}`, () => {
      cy.on('uncaught:exception', (err) => {
        failedRoutes.push(`${route}: ${err.message}`)
        return false
      })

      cy.visit(`${route}?host=0`)
      cy.get('body').should('exist')
    })
  }
})
