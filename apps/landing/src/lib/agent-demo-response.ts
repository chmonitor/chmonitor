/** Deterministic mock agent replies for the landing hero prompt bar. */

const DEFAULT_LINES = [
  'Scanning system.query_log on host 2…',
  'Found 847 executions · p99 4.2s · peak memory 2.1 GiB',
  'Recommend: partition by toYYYYMM(event_date), add minmax skip index on user_id',
] as const

const REPLICATION_LINES = [
  'Checking system.replicas and replication_queue…',
  'Max lag 42s on shard 3 · 1 readonly replica on prod-eu-2',
  'Recommend: verify ZooKeeper session, check merges blocking parts',
] as const

const SLOW_QUERY_LINES = [
  'Pulling top queries from system.query_log (last 1h)…',
  'Worst: SELECT … FROM events_daily — 18.4s avg · 4.2 GiB memory',
  'Recommend: PREWHERE on event_date, projection on user_id',
] as const

const STORAGE_LINES = [
  'Aggregating system.parts by database and table…',
  'Largest: analytics.events_raw — 2.8 TiB · 1,204 active parts',
  'Recommend: TTL on event_time, tune merge max bytes',
] as const

export function agentDemoLinesForPrompt(prompt: string): readonly string[] {
  const p = prompt.toLowerCase()
  if (p.includes('replic') || p.includes('lag') || p.includes('readonly')) {
    return REPLICATION_LINES
  }
  if (
    p.includes('slow') ||
    p.includes('query') ||
    p.includes('p99') ||
    p.includes('latency')
  ) {
    return SLOW_QUERY_LINES
  }
  if (
    p.includes('disk') ||
    p.includes('storage') ||
    p.includes('merge') ||
    p.includes('part')
  ) {
    return STORAGE_LINES
  }
  return DEFAULT_LINES
}

export const HERO_DEMO_SUGGESTIONS = [
  'Why is events_daily slow on host 2?',
  'Show replication lag across shards',
  'Which tables use the most disk?',
] as const
