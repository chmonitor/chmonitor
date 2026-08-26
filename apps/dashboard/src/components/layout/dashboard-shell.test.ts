/**
 * At 768 the header is one nowrap row. The title cluster must not be the
 * flex leftover (`min-w-0 flex-1` + truncate → "Over…").
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), './dashboard-shell.tsx'),
  'utf8'
)

describe('dashboard header title cluster', () => {
  test('does not shrink so Overview stays readable at 768', () => {
    expect(src).toContain(
      'className="flex shrink-0 items-center gap-2 px-3 pt-2 sm:px-4 sm:pt-0"'
    )
    expect(src).not.toContain(
      'flex min-w-0 flex-1 items-center gap-2 px-3 pt-2'
    )
  })

  test('header actions can scroll instead of compressing the title', () => {
    expect(src).toContain('sm:flex-1')
    expect(src).toContain('lg:flex-none lg:overflow-visible')
  })
})
