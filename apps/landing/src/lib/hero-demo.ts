export type HeroDemoTab = {
  id: string
  label: string
  headline: string
  description: string
  screenshot: {
    src: string
    alt: string
  }
  prompt?: string
  metrics?: { label: string; value: string }[]
}

export const HERO_DEMO_TABS: HeroDemoTab[] = [
  {
    id: 'overview',
    label: 'Overview',
    headline: 'Cluster pulse at a glance',
    description:
      'Connections, merges, replication lag and AI insights on one screen — refreshed from system tables.',
    screenshot: {
      src: '/landing-assets/overview-insights-dark.webp',
      alt: 'Overview with AI insights across replicas, merges and compression',
    },
    metrics: [
      { label: 'Queries/min', value: '1.2k' },
      { label: 'Replicas', value: '12' },
      { label: 'Merge backlog', value: '3' },
    ],
  },
  {
    id: 'agent',
    label: 'AI Agent',
    headline: 'Ask the cluster, get a plan',
    description:
      'Partition keys, skip indexes, PREWHERE rewrites — the agent reads schema and query_log before recommending.',
    screenshot: {
      src: '/landing-assets/ai-agent-new-dark.webp',
      alt: 'AI agent recommending partition keys, skip indexes and PREWHERE rewrites',
    },
    prompt: 'Why is events_daily slow on host 2?',
  },
  {
    id: 'queries',
    label: 'Queries',
    headline: 'Catch slow queries before users do',
    description:
      'Running queries, slow-query patterns, memory peaks and EXPLAIN — ranked worst-first with occurrence charts.',
    screenshot: {
      src: '/landing-assets/slow-queries-new-dark.webp',
      alt: 'Slow queries with occurrence chart and worst-first table',
    },
    metrics: [
      { label: 'Running', value: '47' },
      { label: 'P99 latency', value: '2.4s' },
      { label: 'Failed (1h)', value: '3' },
    ],
  },
  {
    id: 'health',
    label: 'Health',
    headline: 'Threshold alerts to any webhook',
    description:
      'Disk, replication, mutations and custom rules — Opsgenie, PagerDuty, Slack or your own endpoint.',
    screenshot: {
      src: '/landing-assets/cluster-topology-new-dark.webp',
      alt: 'Cluster topology map of shards and replicas',
    },
    metrics: [
      { label: 'Checks', value: '24' },
      { label: 'Critical', value: '0' },
      { label: 'Warning', value: '2' },
    ],
  },
  {
    id: 'explorer',
    label: 'Explorer',
    headline: 'Schema graph and dependency map',
    description:
      'Browse databases, projections, indexes and table lineage — DDL export with beautify toggle.',
    screenshot: {
      src: '/landing-assets/data-explorer-new-dark.webp',
      alt: 'Data explorer table dependency graph',
    },
  },
]

export function getHeroDemoTab(id: string): HeroDemoTab | undefined {
  return HERO_DEMO_TABS.find((tab) => tab.id === id)
}

export function heroDemoPreviewForTab(id: string) {
  const tab = getHeroDemoTab(id)
  if (!tab) return null
  return {
    headline: tab.headline,
    description: tab.description,
    screenshotSrc: tab.screenshot.src,
    screenshotAlt: tab.screenshot.alt,
  }
}
