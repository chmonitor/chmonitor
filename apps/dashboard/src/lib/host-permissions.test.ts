import type { SourceEngine } from '@chm/types'
import type { MergedHostInfo } from '@/lib/swr/use-merged-hosts'

import {
  canEditHost,
  getHostEngineMeta,
  getHostSourceMeta,
} from './host-permissions'
import { describe, expect, test } from 'bun:test'

const SOURCES: MergedHostInfo['source'][] = [
  'env',
  'demo',
  'browser',
  'database',
]

describe('canEditHost', () => {
  test('user-owned sources (browser, database) are editable', () => {
    expect(canEditHost('browser')).toBe(true)
    expect(canEditHost('database')).toBe(true)
  })

  test('operator/read-only sources (env, demo) are not editable', () => {
    // env hosts come from CLICKHOUSE_HOST; demo is the public read-only host.
    // The edit UI must be gated off for both so users never see a dead form.
    expect(canEditHost('env')).toBe(false)
    expect(canEditHost('demo')).toBe(false)
  })

  test('every known source resolves to a boolean (no accidental undefined)', () => {
    for (const source of SOURCES) {
      expect(typeof canEditHost(source)).toBe('boolean')
    }
  })
})

describe('getHostSourceMeta', () => {
  test('returns a non-empty label + note for every source', () => {
    for (const source of SOURCES) {
      const meta = getHostSourceMeta(source)
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.note.length).toBeGreaterThan(0)
    }
  })

  test('non-editable sources explain why in the note', () => {
    // The note is what the dialog shows when editing is disabled, so it must
    // actually tell the user why they can't edit.
    const env = getHostSourceMeta('env')
    const demo = getHostSourceMeta('demo')
    expect(env.note.toLowerCase()).toContain('operator')
    expect(demo.note.toLowerCase()).toContain('read-only')
  })
})

describe('getHostEngineMeta', () => {
  const ENGINES: SourceEngine[] = ['clickhouse', 'clickhouse-cloud', 'postgres']

  test('returns the correct label + badge for each engine', () => {
    expect(getHostEngineMeta('clickhouse')).toEqual({
      label: 'ClickHouse',
      badge: 'ClickHouse',
    })
    expect(getHostEngineMeta('clickhouse-cloud')).toEqual({
      label: 'ClickHouse Cloud',
      badge: 'ClickHouse Cloud',
    })
    expect(getHostEngineMeta('postgres')).toEqual({
      label: 'Postgres',
      badge: 'Postgres',
    })
  })

  test('returns a non-empty label + badge for every engine', () => {
    for (const engine of ENGINES) {
      const meta = getHostEngineMeta(engine)
      expect(meta.label.length).toBeGreaterThan(0)
      expect(meta.badge.length).toBeGreaterThan(0)
    }
  })
})
