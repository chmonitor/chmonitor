import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'app.css'), 'utf8')
const page = readFileSync(join(here, '../routes/$.tsx'), 'utf8')

/** Unlayered rules after the last `:root { ... }` — beats Tailwind utilities. */
function unlayeredCss(src) {
  const marker = src.lastIndexOf('--fd-layout-width:')
  assert.ok(marker > -1, 'expected --fd-layout-width in app.css')
  const blockEnd = src.indexOf('}', marker)
  assert.ok(blockEnd > -1, 'expected closing brace after --fd-layout-width')
  return src.slice(blockEnd + 1)
}

describe('docs article actions: Copy Markdown and Open tap targets ≥44px', () => {
  test('marks the article action row (not header chrome)', () => {
    assert.match(page, /data-article-actions/)
    assert.match(page, /MarkdownCopyButton/)
    assert.match(page, /ViewOptionsPopover/)
    assert.match(page, /className="max-md:min-h-11"/)
    assert.match(page, /className="max-md:min-h-11 max-md:min-w-11"/)
    assert.doesNotMatch(page, /#nd-nav|#nd-subnav|data-search/)
  })

  test('pads article action buttons at the md breakpoint', () => {
    const extra = unlayeredCss(css)
    const article = extra.match(
      /@media \(max-width:\s*768px\)\s*\{[\s\S]*?\[data-article-actions\] button[\s\S]*?\n\}/
    )
    assert.ok(article, 'expected 768px [data-article-actions] rule')
    assert.ok(article[0].includes('min-height: 44px'))
    assert.ok(article[0].includes('min-width: 44px'))
    assert.doesNotMatch(article[0], /#nd-nav|#nd-subnav/)
  })

  test('keeps the visual glyph size (no svg width/height override)', () => {
    const extra = unlayeredCss(css)
    assert.doesNotMatch(extra, /svg[\s\S]{0,80}(width|height|font-size)/)
    assert.ok(!extra.includes('[&_svg]'))
  })
})
