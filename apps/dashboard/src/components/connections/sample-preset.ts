import type { BrowserConnection } from '@/lib/types/browser-connection'

// Not imported from connection-form.tsx: it imports this file (circular).
type SampleClusterPreset = Pick<
  BrowserConnection,
  'name' | 'host' | 'user' | 'password'
>

/**
 * The public ClickHouse Playground. `explorer` is a documented public,
 * read-only account (enforced by ClickHouse grants), so it is safe in client
 * code. It is denied SELECT on query_log, parts, merges, processes, replicas,
 * mutations, disks, and errors, so monitoring pages show empty/error states:
 * copy must not promise a full monitoring demo.
 */
export const SAMPLE_CLUSTER_PRESET: SampleClusterPreset = {
  name: 'Sample ClickHouse (read-only)',
  host: 'https://play.clickhouse.com',
  user: 'explorer',
  password: '',
}

export function isSampleClusterHost(host: string): boolean {
  return host.trim() === SAMPLE_CLUSTER_PRESET.host
}
