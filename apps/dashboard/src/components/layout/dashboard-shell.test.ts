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
    // sm+ stays intrinsic-width so the title is never ellipsized at 768; on
    // phones it fills row 1 to push the utility icons right. No phone-only
    // top padding: it offset the separator from the toggle and title.
    expect(identitySrc).toContain(
      'className="flex shrink-0 items-center gap-2 max-sm:flex-1 sm:px-4"'
    )
    expect(identitySrc).not.toContain('flex min-w-0 flex-1')
    expect(identitySrc).not.toContain('pt-2')
    // The base vertical Separator self-stretches; centre it at h-4.
    expect(identitySrc).toContain('data-vertical:h-4 data-vertical:self-center')
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
