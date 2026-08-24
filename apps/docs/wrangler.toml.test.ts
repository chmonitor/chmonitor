import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const toml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'wrangler.toml'),
  'utf8'
)

describe('docs wrangler assets', () => {
  test('does not run the Worker before hashed CSS/JS under /assets', () => {
    expect(toml).not.toMatch(/^\s*run_worker_first\s*=\s*true\s*$/m)
    expect(toml).toContain('"/api/*"')
    expect(toml).toContain('!/assets/*')
    expect(toml).toContain('!/brand/*')
  })
})
