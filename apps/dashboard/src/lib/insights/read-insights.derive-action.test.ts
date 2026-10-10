/**
 * The findings store keeps scalars only, so an insight's action link is
 * re-derived from `metric` on every read (`deriveAction`). A collector metric
 * without a case silently loses its link after the first reload. This test
 * reads every literal `metric: '...'` the ClickHouse collectors emit straight
 * from source, so a new check cannot ship without a link.
 */

import { deriveAction } from './read-insights'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// tsc does not type Bun's import.meta.dir; use the portable form.
const HERE = fileURLToPath(new URL('.', import.meta.url))

const COLLECTOR_SOURCES = [
  'collectors.ts',
  'operational-checks.ts',
  'ttl-partition-collector.ts',
]

function collectorMetrics(): Map<string, string> {
  const out = new Map<string, string>()
  for (const file of COLLECTOR_SOURCES) {
    const src = readFileSync(join(HERE, file), 'utf8')
    // Candidates declare `category` then `metric` on adjacent lines.
    for (const m of src.matchAll(
      /category: '([a-z]+)',\s*metric: '([a-z0-9_]+)'/g
    )) {
      out.set(m[2], m[1])
    }
    // Anomaly checks declare `metric` without a category on the same object.
    for (const m of src.matchAll(/^\s+metric: '([a-z0-9_]+)',$/gm)) {
      if (!out.has(m[1])) out.set(m[1], 'anomaly')
    }
  }
  return out
}

describe('deriveAction covers every collector metric', () => {
  const metrics = collectorMetrics()

  test('the source scan finds the known metrics (guards the regex)', () => {
    for (const known of [
      'error_rate',
      'detached_parts',
      'broken_detached_parts',
      'stuck_replication_queue',
      'insert_backpressure',
      'ttl_partition_health',
      'parts_pressure',
    ]) {
      expect(metrics.has(known)).toBe(true)
    }
  })

  for (const [metric, category] of collectorMetrics()) {
    test(`${metric} maps to a dashboard link`, () => {
      const action = deriveAction(metric, category)
      expect(action?.href).toMatch(/^\/[a-z]/)
    })
  }

  test('new checks link to the page that shows the problem', () => {
    expect(deriveAction('broken_detached_parts', 'storage')?.href).toBe(
      '/detached-parts'
    )
    expect(deriveAction('detached_parts', 'storage')?.href).toBe(
      '/detached-parts'
    )
    expect(deriveAction('stuck_replication_queue', 'reliability')?.href).toBe(
      '/replication-queue'
    )
    expect(deriveAction('insert_backpressure', 'performance')?.href).toBe(
      '/merges'
    )
  })
})
