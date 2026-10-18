/**
 * The connection model stores one `host` URL (no secure/port field), so the
 * ClickHouse Cloud preset is realized by normalizing that URL.
 */

import type { SourceEngine } from '@chm/types'

export type ConnectionPreset = 'self-hosted' | 'clickhouse-cloud' | 'postgres'

export function engineForPreset(preset: ConnectionPreset): SourceEngine {
  switch (preset) {
    case 'clickhouse-cloud':
      return 'clickhouse-cloud'
    case 'postgres':
      return 'postgres'
    default:
      return 'clickhouse'
  }
}

export function addHostDialogChrome(preset: ConnectionPreset): {
  title: string
  description: string
} {
  if (preset === 'postgres') {
    return {
      title: 'Add Postgres source',
      description:
        'Connect a Postgres database for read-only monitoring. It needs a reachable host on the Postgres port and a user that can read pg_stat_* — see the guidance on the right for requirements and how your credentials are stored.',
    }
  }
  return {
    title: 'Add ClickHouse host',
    description:
      'Point chmonitor at a ClickHouse cluster to start monitoring. It needs a user with SELECT on system.* — see the guidance on the right for grants, firewall setup, and how your credentials are stored.',
  }
}

export const POSTGRES_DEFAULT_PORT = 5432

export const POSTGRES_HOST_PLACEHOLDER = 'db.example.com'

export const CLOUD_DEFAULT_PORT = 8443

export const CLOUD_HOST_PLACEHOLDER =
  'https://<service-id>.<region>.<cloud>.clickhouse.cloud:8443'

export const SELF_HOSTED_HOST_PLACEHOLDER =
  'https://clickhouse.example.com:8123'

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * A bare hostname gets `https://` and port 8443; a full URL only gets a missing
 * port. An explicit `http://` is never rewritten: the Cloud TLS error hint
 * covers that instead.
 */
export function applyCloudHostDefaults(host: string): string {
  const trimmed = host.trim()
  if (!trimmed) return trimmed

  if (!SCHEME_RE.test(trimmed)) {
    const [hostname, port] = trimmed.split(':')
    return `https://${hostname}:${port ?? CLOUD_DEFAULT_PORT}`
  }

  try {
    const url = new URL(trimmed)
    if (!url.port && url.protocol === 'https:') {
      url.port = String(CLOUD_DEFAULT_PORT)
      return url.origin
    }
    return trimmed
  } catch {
    return trimmed
  }
}
