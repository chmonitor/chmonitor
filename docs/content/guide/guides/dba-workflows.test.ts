import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, 'dba-workflows.mdx'), 'utf8')

const CLOSED_TRACKING_ISSUES = [3072, 3073, 3074, 3075, 3077]

describe('dba-workflows guide', () => {
  test('keeps the what-exists-today table', () => {
    expect(src).toContain('## What exists today')
    expect(src).toContain('/settings-diff')
    expect(src).toContain('/schema-diff')
    expect(src).toContain('/advisor')
    expect(src).toContain('/storage-economics')
    expect(src).toContain('/explorer')
    expect(src).toContain('/ttl-partition-health')
    expect(src).toContain('Tables → TTL & Partitions')
    expect(src).toContain('TTL & Partition Health')
    expect(src).toContain('/health')
    expect(src).toContain('/assets/screenshots/tools-advisor-dark.jpeg')
    expect(src).toContain('/assets/screenshots/chm-schema-compare.png')
    expect(src).not.toContain('System → TTL')
  })

  test('does not cite closed issues as planned work', () => {
    for (const n of CLOSED_TRACKING_ISSUES) {
      expect(src).not.toContain(`#${n}`)
      expect(src).not.toContain(`/issues/${n}`)
    }
    expect(src).not.toMatch(/not implemented yet/i)
    expect(src).not.toContain('## Gaps (not shipped)')
  })

  test('does not list Settings role presets as a gap after they shipped', () => {
    expect(src).not.toMatch(
      /Settings has no role presets or workspace customization/i
    )
  })
})
