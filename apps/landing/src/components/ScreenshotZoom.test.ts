import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('ScreenshotShot theme pairing', () => {
  const source = readFileSync(
    join(import.meta.dir, 'ScreenshotShot.astro'),
    'utf8'
  )

  test('only tags data-shot on the inline preview when a dark variant exists', () => {
    expect(source).toContain(
      "...(paired ? { 'data-shot': 'light' as const } : {})"
    )
    const previewBlock = source.slice(
      source.indexOf('data-screenshot-zoom'),
      source.indexOf('</button>')
    )
    expect(previewBlock).not.toContain('data-shot="light"')
  })
})
