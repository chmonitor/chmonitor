import type { SourceEngine } from '@chm/types'
import type { MergedHostInfo } from '@/lib/swr/use-merged-hosts'

/**
 * Whether a host's connection credentials can be edited in-app.
 *
 * Only user-owned storage (`browser` localStorage + `database` D1 connections)
 * is editable. Operator-configured env hosts (`env`) come from CLICKHOUSE_HOST
 * and the public read-only `demo` is fixed — neither has an in-app edit path.
 *
 * This is the single source of truth for the "disable edit based on permission"
 * gate used by the host details dialog.
 */
export function canEditHost(source: MergedHostInfo['source']): boolean {
  return source === 'browser' || source === 'database'
}

export interface HostSourceMeta {
  /** Short badge label for the host details dialog header. */
  label: string
  /** Why this host can / can't be edited — shown as a muted note. */
  note: string
}

/** Display + explanation metadata for each host source. */
export function getHostSourceMeta(
  source: MergedHostInfo['source']
): HostSourceMeta {
  switch (source) {
    case 'env':
      return {
        label: 'Operator',
        note: 'Configured by the operator via environment variables. Edit the CLICKHOUSE_HOST env var to change it.',
      }
    case 'demo':
      return {
        label: 'Demo · read-only',
        note: 'Public read-only ClickHouse demo. Credentials are fixed; switch to your own host to make changes.',
      }
    case 'database':
      return {
        label: 'Server (synced)',
        note: 'Stored encrypted on the server and synced across devices when signed in.',
      }
    default:
      return {
        label: 'This browser',
        note: 'Stored encrypted in this browser only.',
      }
  }
}

export interface HostEngineMeta {
  /** Full engine name for tooltips / dialog headers. */
  label: string
  /** Short badge text for the host switcher. */
  badge: string
}

/**
 * Display metadata for a host's source engine — orthogonal to
 * {@link getHostSourceMeta} (storage-origin). Rendered as an engine badge in
 * the host switcher; this is inert plumbing (phase 1, #2448), so nothing calls
 * it yet and the storage-origin edit rules are untouched.
 */
export function getHostEngineMeta(engine: SourceEngine): HostEngineMeta {
  switch (engine) {
    case 'clickhouse-cloud':
      return { label: 'ClickHouse Cloud', badge: 'ClickHouse Cloud' }
    case 'postgres':
      return { label: 'Postgres', badge: 'Postgres' }
    default:
      return { label: 'ClickHouse', badge: 'ClickHouse' }
  }
}
