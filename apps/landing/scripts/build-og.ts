/**
 * Open Graph cards for chmonitor.dev.
 *
 * Shared compositor: scripts/og-builder.ts (dune plate, centered title,
 * logo top-left). Run:  bun run scripts/build-og.ts
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FEATURE_PAGES } from '../src/data/feature-pages'
import { writeOgCard, type OgCard } from '../../../scripts/og-builder'

const here = join(fileURLToPath(import.meta.url), '..')
const fontsDir = join(here, 'og-fonts')
const fonts = [
  'inter-400',
  'inter-500',
  'inter-600',
  'inter-700',
  'jbm-500',
  'jbm-600',
].map((f) => join(fontsDir, `${f}.ttf`))

const HOME: OgCard = {
  out: 'apps/landing/public/og/og.png',
  eyebrow: 'OPEN SOURCE',
  title: 'The ops dashboard\nfor ClickHouse.',
  sub: 'Monitor queries, merges, parts, replication, and health.\nAn AI advisor on top — open source, self-host free.',
  domain: 'chmonitor.dev',
  plate: 'landing',
  logo: 'top-left',
}

const PAGES: OgCard[] = [
  {
    out: 'apps/landing/public/og/og-light.png',
    eyebrow: 'OPEN SOURCE',
    title: 'The ops dashboard\nfor ClickHouse.',
    sub: 'Monitor queries, merges, parts, replication, and health.\nAn AI advisor on top — open source, self-host free.',
    domain: 'chmonitor.dev',
    plate: 'landing',
    ink: 'light',
    logo: 'top-left',
  },
  {
    out: 'apps/landing/public/og/og-cli.png',
    eyebrow: 'CLI',
    title: 'chmonitor from\nthe terminal',
    sub: 'Talks to your dashboard. Ready for AI agents.',
    domain: 'chmonitor.dev',
  },
  {
    out: 'apps/landing/public/og/og-pricing.png',
    eyebrow: 'PRICING',
    title: 'Simple pricing\nthat scales with you',
    sub: 'Self-host free under GPL-3.0, or the hosted cloud.',
    domain: 'chmonitor.dev',
  },
  {
    out: 'apps/landing/public/og/og-changelog.png',
    eyebrow: 'RELEASES',
    title: "What's new in\nchmonitor",
    sub: 'Release notes for every version — dashboard, AI advisor, monitoring.',
    domain: 'chmonitor.dev',
    logo: 'bottom-right',
  },
  {
    out: 'apps/landing/public/og/og-customers.png',
    eyebrow: 'CUSTOMERS',
    title: 'Companies that\nlicensed chmonitor',
    sub: 'Teams that bought a commercial license and chose to be listed.',
    domain: 'chmonitor.dev',
  },
  {
    out: 'apps/landing/public/og/og-monitor-queries.png',
    eyebrow: 'QUERY MONITORING',
    title: 'Monitor ClickHouse\nqueries, live',
    sub: 'Running, slow, failed, expensive — kill it, or get an EXPLAIN fix.',
    domain: 'chmonitor.dev',
  },
  {
    out: 'apps/landing/public/og/og-cluster-health.png',
    eyebrow: 'CLUSTER HEALTH',
    title: 'Cluster health,\nat a glance',
    sub: 'Every health signal in one board, with alerts to Slack or Discord.',
    domain: 'chmonitor.dev',
  },
  {
    out: 'apps/landing/public/og/og-replication.png',
    eyebrow: 'REPLICATION',
    title: 'Monitor ClickHouse\nreplication lag',
    sub: 'Topology, read-only replicas, replication and DDL queues.',
    domain: 'chmonitor.dev',
  },
  {
    out: 'apps/landing/public/og/og-performance.png',
    eyebrow: 'PERFORMANCE',
    title: 'Query performance\ntuning',
    sub: 'Slowest queries, EXPLAIN suggestions, capacity and TTL advisor.',
    domain: 'chmonitor.dev',
  },
  {
    out: 'apps/landing/public/og/og-vs-clickhouse-cloud.png',
    eyebrow: 'VS CLICKHOUSE CLOUD',
    title: 'chmonitor vs\nClickHouse Cloud',
    sub: 'An independent ops and advisor layer, not a hosting replacement.',
    domain: 'chmonitor.dev',
  },
  {
    out: 'apps/landing/public/og/og-vs-datadog.png',
    eyebrow: 'VS DATADOG',
    title: 'chmonitor vs\nDatadog',
    sub: 'ClickHouse specialist vs full-stack APM — feature by feature.',
    domain: 'chmonitor.dev',
  },
  {
    out: 'apps/landing/public/og/og-vs-grafana.png',
    eyebrow: 'VS GRAFANA',
    title: 'chmonitor vs\nGrafana',
    sub: 'ClickHouse-native pages vs a general-purpose dashboard canvas.',
    domain: 'chmonitor.dev',
  },
  {
    out: 'apps/landing/public/og/og-clickhouse-vs-postgres.png',
    eyebrow: 'COMPARISON',
    title: 'ClickHouse vs\nPostgres',
    sub: 'Columnar vs row store for analytics — the real trade-offs.',
    domain: 'chmonitor.dev',
  },
  {
    out: 'apps/landing/public/og/og-clickhouse-vs-timescaledb.png',
    eyebrow: 'COMPARISON',
    title: 'ClickHouse vs\nTimescaleDB',
    sub: 'When a Postgres extension is enough, and when it is not.',
    domain: 'chmonitor.dev',
  },
  {
    out: 'apps/landing/public/og/og-clickhouse-vs-druid-pinot.png',
    eyebrow: 'COMPARISON',
    title: 'ClickHouse vs\nDruid & Pinot',
    sub: 'OLAP engines compared for ops, latency, and ops overhead.',
    domain: 'chmonitor.dev',
  },
  ...FEATURE_PAGES.map(
    (p): OgCard => ({
      out: `apps/landing/public/og/og-features-${p.slug}.png`,
      eyebrow: p.eyebrow,
      title: p.h1,
      sub: p.subhead,
      domain: 'chmonitor.dev',
      logo: 'top-left',
    })
  ),
]

await writeOgCard(HOME, { fonts })
for (const page of PAGES) {
  await writeOgCard(
    {
      plate: 'landing',
      logo: 'top-left',
      ...page,
    },
    { fonts }
  )
}
console.log('done')
