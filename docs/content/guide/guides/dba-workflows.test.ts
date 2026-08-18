import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(import.meta.dir, 'dba-workflows.mdx'), 'utf8')

const CLOSED_TRACKING_ISSUES = [3072, 3073, 3074, 3075, 3077]

describe('dba-workflows guide', () => {
  test('keeps the what-exists-today table', () => {
    expect(src).toContain('## What exists today')
    expect(src).toContain('/settings-diff')
    expect(src).toContain('/advisor')
    expect(src).toContain('/storage-economics')
    expect(src).toContain('/explorer')
  })

  test('does not cite closed issues as planned work', () => {
    for (const n of CLOSED_TRACKING_ISSUES) {
      expect(src).not.toContain(`#${n}`)
      expect(src).not.toContain(`/issues/${n}`)
    }
    expect(src).not.toMatch(/not implemented yet/i)
    expect(src).toContain('## Gaps (not shipped)')
  })
})
