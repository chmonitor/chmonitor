/**
 * Header title must stay fully readable at 768. Source-level so the
 * truncate / parent-crumb breakpoints cannot regress without this test.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), './breadcrumb.tsx'),
  'utf8'
)

describe('header breadcrumb title', () => {
  test('current page does not ellipsize', () => {
    expect(src).toContain('className="shrink-0 font-medium text-foreground"')
    expect(src).not.toContain('truncate font-medium text-foreground')
  })

  test('parent crumbs wait until lg so tablet shows only the page title', () => {
    expect(src).toContain("isLast ? 'shrink-0' : 'hidden lg:flex'")
    expect(src).toContain('hidden size-3.5 shrink-0 lg:block')
    expect(src).not.toContain('hidden truncate')
    expect(src).not.toContain('sm:inline')
  })
})
