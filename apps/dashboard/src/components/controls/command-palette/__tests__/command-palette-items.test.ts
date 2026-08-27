import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../command-palette-items.tsx'),
  'utf8'
)

describe('command palette header trigger', () => {
  test('keeps the Search… field at lg so 768 does not steal title space', () => {
    expect(src).toContain('min-h-11 min-w-11 lg:hidden')
    expect(src).toContain('lg:inline-flex')
    expect(src).not.toContain('md:hidden')
    expect(src).not.toContain('md:inline-flex')
  })
})

describe('command palette row titles', () => {
  test('stay on one line so TTL & Partitions does not wrap on &', () => {
    expect(src).toContain(
      "const TITLE_CLASS = 'font-medium whitespace-nowrap shrink-0'"
    )
    expect(src).toContain('className={TITLE_CLASS}')
    expect(src).toContain('min-w-0 flex-1 truncate')
  })
})

describe('command palette hidden pages', () => {
  test('workspace-hidden rows get a Hidden hint', () => {
    expect(src).toContain('palette-hidden-hint')
    expect(src).toContain('hiddenHrefs')
  })

  test('indexes the allowed catalog, not the sidebar hide list', () => {
    const paletteSrc = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../command-palette.tsx'
      ),
      'utf8'
    )
    expect(paletteSrc).toContain('usePaletteMenuItems')
    expect(paletteSrc).not.toMatch(/\buseVisibleMenuItems\b/)
  })
})
