import { NON_CRITICAL_RETRY } from '../config'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))

/**
 * Non-critical, always-on polling hooks must cap retries via the shared
 * NON_CRITICAL_RETRY constant instead of inheriting the global `retry: 3`
 * default (src/lib/query/provider.tsx). Otherwise a single transient blip or a
 * missing optional table amplifies into 4 Worker→ClickHouse round-trips per
 * poll. See issue #2180.
 */
describe('NON_CRITICAL_RETRY', () => {
  test('is a low, bounded retry budget below the global default of 3', () => {
    expect(NON_CRITICAL_RETRY).toBeLessThan(3)
    expect(NON_CRITICAL_RETRY).toBeGreaterThanOrEqual(0)
    expect(NON_CRITICAL_RETRY).toBe(1)
  })

  // Each always-on hook that inherited (or over-set) retries must now source its
  // retry budget from the shared constant — asserting intent, not a literal.
  const targets = [
    '../use-host-status.ts',
    '../use-cluster-count.ts',
    '../use-notifications.ts',
    '../../ai/agent/use-ai-quota.ts',
  ]

  for (const rel of targets) {
    test(`${rel} passes retry: NON_CRITICAL_RETRY`, () => {
      const src = readFileSync(new URL(rel, `file://${here}`), 'utf8')
      expect(src).toContain('NON_CRITICAL_RETRY')
      expect(src).toMatch(/retry:\s*NON_CRITICAL_RETRY/)
      // Guard against a stray hardcoded retry override sneaking back in.
      expect(src).not.toMatch(/retry:\s*\d/)
    })
  }
})
