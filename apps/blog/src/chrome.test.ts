import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const blog = join(import.meta.dir, '..')
const read = (rel: string) => readFileSync(join(blog, rel), 'utf8')

describe('blog chrome matches landing shadcn tokens', () => {
  test('Base imports the new globals.css', () => {
    expect(existsSync(join(blog, 'src/styles/globals.css'))).toBe(true)
    expect(read('src/layouts/Base.astro')).toContain(
      "import '../styles/globals.css'"
    )
  })

  test('globals.css keeps landing brand / hairline / shadcn tokens', () => {
    const css = read('src/styles/globals.css')
    expect(css).toContain('--brand')
    expect(css).toContain('--brand-ink')
    expect(css).toContain('--brand-soft')
    expect(css).toContain('--surface-strong')
    expect(css).toContain('--hairline-soft')
    expect(css).toContain('--hairline-strong')
    expect(css).toContain("@custom-variant dark (&:is([data-theme='dark'] *))")
  })

  test('Nav uses semantic token classes', () => {
    const nav = read('src/components/Nav.astro')
    expect(nav).toContain('text-muted-foreground')
    expect(nav).toContain('border-border')
  })

  test('Footer uses semantic token classes', () => {
    const footer = read('src/components/Footer.astro')
    expect(footer).toContain('text-muted-foreground')
    expect(footer).toContain('border-border')
  })

  test('featured card is not the old #fff8f1 hardcode', () => {
    const home = read('src/pages/index.astro')
    const base = read('src/layouts/Base.astro')
    expect(home).not.toContain('#fff8f1')
    expect(base).not.toContain('#fff8f1')
    expect(home).toContain('bg-card')
    expect(home).toContain('--brand-soft')
  })
})
