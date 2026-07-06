import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('ScreenshotZoom theme pairing', () => {
  const source = readFileSync(
    join(import.meta.dir, 'ScreenshotZoom.tsx'),
    'utf8'
  )

  test('only tags data-shot on the inline preview when a dark variant exists', () => {
    expect(source).toContain(
      "...(srcDark ? { 'data-shot': 'light' as const } : {})"
    )
    const previewImg = source.slice(
      source.indexOf('aria-label={'),
      source.indexOf('{srcDark ? (')
    )
    expect(previewImg).not.toContain('data-shot="light"')
  })
})
