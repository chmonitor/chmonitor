/**
 * The dashboard shell delegates the responsive header contract to two focused
 * regions instead of rebuilding the title/action flex relationship inline.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const componentDir = dirname(fileURLToPath(import.meta.url))
const shellSrc = readFileSync(
  join(componentDir, './dashboard-shell.tsx'),
  'utf8'
)
const identitySrc = readFileSync(
  join(componentDir, '../header/header-identity.tsx'),
  'utf8'
)
const actionsSrc = readFileSync(
  join(componentDir, '../header/header-actions.tsx'),
  'utf8'
)

describe('dashboard header composition', () => {
  test('uses focused identity and action regions', () => {
    expect(shellSrc).toContain('<HeaderIdentity />')
    expect(shellSrc).toContain('<HeaderActionRegion>')
    expect(shellSrc).toContain('<HeaderActions />')
    expect(shellSrc).not.toContain('<Breadcrumb />')
  })

  test('keeps the page identity intrinsic-width and readable', () => {
    expect(identitySrc).toContain(
      'className="flex shrink-0 items-center gap-2 px-3 pt-2 sm:px-4 sm:pt-0"'
    )
    expect(identitySrc).not.toContain('flex min-w-0 flex-1')
  })

  test('keeps the action controls right-aligned and bounded', () => {
    expect(actionsSrc).toContain(
      'data-testid="dashboard-header-action-controls"'
    )
    expect(actionsSrc).toContain('justify-end')
    expect(actionsSrc).toContain('max-w-full')
    expect(actionsSrc).not.toContain('sm:ml-auto')
  })
})
