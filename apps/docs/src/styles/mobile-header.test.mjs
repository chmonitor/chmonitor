import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app.css'), 'utf8')

/** Unlayered rules after the last `:root { ... }` — beats Tailwind utilities. */
function unlayeredCss(src) {
  const marker = src.lastIndexOf('--fd-layout-width:')
  assert.ok(marker > -1, 'expected --fd-layout-width in app.css')
  const blockEnd = src.indexOf('}', marker)
  assert.ok(blockEnd > -1, 'expected closing brace after --fd-layout-width')
  return src.slice(blockEnd + 1)
}

describe('docs mobile header: search and menu tap targets ≥44px', () => {
  test('pads header icon buttons at the hamburger breakpoint', () => {
    const extra = unlayeredCss(css)
    assert.match(
      extra,
      /@media \(max-width:\s*1024px\)[\s\S]*?#nd-nav \[data-search\]/
    )
    assert.ok(extra.includes("#nd-nav [aria-label='Toggle Menu']"))
    assert.ok(extra.includes('#nd-subnav [data-search]'))
    assert.ok(extra.includes("#nd-subnav [aria-label='Open Sidebar']"))
    assert.ok(extra.includes('min-width: 44px'))
    assert.ok(extra.includes('min-height: 44px'))
  })

  test('keeps the visual glyph size (no svg width/height override)', () => {
    const extra = unlayeredCss(css)
    assert.doesNotMatch(extra, /svg[\s\S]{0,80}(width|height|font-size)/)
    assert.ok(!extra.includes('[&_svg]'))
  })
})
