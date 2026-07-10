import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('ScreenshotShot theme pairing', () => {
  const source = readFileSync(
    join(import.meta.dir, 'ScreenshotShot.astro'),
    'utf8'
  )

  test('renders a single themed <img> per slot (no light/dark sibling pair)', () => {
    const previewBlock = source.slice(
      source.indexOf('data-screenshot-zoom'),
      source.indexOf('</button>')
    )
    const imgCount = (previewBlock.match(/<img\b/g) || []).length
    expect(imgCount).toBe(1)
    expect(previewBlock).toContain('data-src-light={src}')
    expect(previewBlock).toContain('data-src-dark={srcDark}')
  })
})
