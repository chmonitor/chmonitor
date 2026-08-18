import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve(import.meta.dir, 'use-mobile.tsx'), 'utf8')

describe('layout breakpoints', () => {
  test('phones stay below Tailwind md; sidebar overlays below lg', () => {
    expect(src).toContain('export const MOBILE_BREAKPOINT = 768')
    expect(src).toContain('export const LG_BREAKPOINT = 1024')
  })
})
