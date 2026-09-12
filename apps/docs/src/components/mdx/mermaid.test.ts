import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'mermaid.tsx'),
  'utf8'
)

describe('Mermaid loading placeholder', () => {
  test('does not return null while hydrating', () => {
    expect(src).not.toMatch(/if\s*\(\s*!svg\s*\)\s*return\s+null/)
  })

  test('shows an accessible loading box before the SVG is ready', () => {
    expect(src).toContain('Loading diagram')
    expect(src).toContain('aria-busy')
    expect(src).toContain('role="status"')
    expect(src).toMatch(/min-h-/)
  })

  test('keeps the error and rendered-svg paths', () => {
    expect(src).toContain('Mermaid error:')
    expect(src).toContain('dangerouslySetInnerHTML')
  })
})
