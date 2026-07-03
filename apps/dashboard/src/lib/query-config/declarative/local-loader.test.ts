/**
 * Tests for the self-hosted local config override loader (Plan 55).
 *
 * These exercise the PURE functions (`getConfigDirectory`, `loadLocalConfigs`)
 * directly against real temp directories/files on disk. `getQueryConfigByName`
 * gates its use of this module behind the build-time `import.meta.env.SSR`
 * constant, which Vite/Rollup replaces per bundle target — under plain
 * `bun:test` (no Vite build step) that constant is not statically folded to
 * `true`, so asserting through the seam here would test the wrong thing.
 * `loadLocalConfigs(dir)` is the stable, directly-testable contract.
 */

import { getConfigDirectory, loadLocalConfigs } from './local-loader'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chm-local-config-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeYaml(name: string, contents: string): void {
  writeFileSync(join(dir, name), contents, 'utf-8')
}

// ---------------------------------------------------------------------------
// getConfigDirectory
// ---------------------------------------------------------------------------

describe('getConfigDirectory', () => {
  test('defaults to /etc/chmonitor/queries.d with no env', () => {
    expect(getConfigDirectory({})).toBe('/etc/chmonitor/queries.d')
  })

  test('reads CHM_CONFIG_DIRECTORY from runtimeEnv', () => {
    expect(getConfigDirectory({ CHM_CONFIG_DIRECTORY: '/custom/dir' })).toBe(
      '/custom/dir'
    )
  })

  test('falls back to default for an empty string value', () => {
    expect(getConfigDirectory({ CHM_CONFIG_DIRECTORY: '' })).toBe(
      '/etc/chmonitor/queries.d'
    )
  })
})

// ---------------------------------------------------------------------------
// loadLocalConfigs — missing / empty directory (must never throw)
// ---------------------------------------------------------------------------

describe('loadLocalConfigs — directory edge cases', () => {
  test('missing directory resolves to empty, does not throw', () => {
    const missing = join(dir, 'does-not-exist')
    expect(() => loadLocalConfigs(missing)).not.toThrow()
    expect(loadLocalConfigs(missing)).toEqual({ loaded: [], skipped: [] })
  })

  test('empty directory resolves to empty result', () => {
    expect(loadLocalConfigs(dir)).toEqual({ loaded: [], skipped: [] })
  })
})

// ---------------------------------------------------------------------------
// loadLocalConfigs — valid + invalid mix (the plan's stated scenario)
// ---------------------------------------------------------------------------

describe('loadLocalConfigs — valid + invalid YAML', () => {
  test('a valid file loads and an invalid-syntax file is skipped, not thrown', () => {
    writeYaml(
      'valid.yaml',
      ['name: my-local-query', 'sql: "SELECT 1"', 'columns:', '  - value'].join(
        '\n'
      )
    )
    // Malformed YAML: inconsistent indentation / unclosed flow sequence.
    writeYaml(
      'broken.yaml',
      ['name: broken', 'sql: "SELECT 1', 'columns: [1, 2'].join('\n')
    )

    let result: ReturnType<typeof loadLocalConfigs>
    expect(() => {
      result = loadLocalConfigs(dir)
    }).not.toThrow()

    expect(result!.loaded).toHaveLength(1)
    expect(result!.loaded[0].name).toBe('my-local-query')

    expect(result!.skipped).toHaveLength(1)
    expect(result!.skipped[0].file).toBe('broken.yaml')
    expect(result!.skipped[0].error.length).toBeGreaterThan(0)
  })

  test('valid YAML syntax that fails schema validation is skipped', () => {
    // Missing required `columns` field.
    writeYaml(
      'no-columns.yaml',
      ['name: missing-columns', 'sql: "SELECT 1"'].join('\n')
    )

    const result = loadLocalConfigs(dir)

    expect(result.loaded).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].file).toBe('no-columns.yaml')
  })

  test('non-.yaml files are ignored', () => {
    writeYaml(
      'valid.yaml',
      ['name: q1', 'sql: "SELECT 1"', 'columns:', '  - v'].join('\n')
    )
    writeFileSync(join(dir, 'notes.txt'), 'hello world', 'utf-8')
    writeFileSync(join(dir, 'other.json'), '{"name":"q2"}', 'utf-8')

    const result = loadLocalConfigs(dir)

    expect(result.loaded).toHaveLength(1)
    expect(result.loaded[0].name).toBe('q1')
    expect(result.skipped).toHaveLength(0)
  })

  test('subdirectories are not recursed into', () => {
    mkdirSync(join(dir, 'nested'))
    writeFileSync(
      join(dir, 'nested', 'inner.yaml'),
      ['name: inner', 'sql: "SELECT 1"', 'columns:', '  - v'].join('\n'),
      'utf-8'
    )

    const result = loadLocalConfigs(dir)

    expect(result.loaded).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
  })

  test('a duplicate name within the directory is skipped, first wins', () => {
    writeYaml(
      'a-first.yaml',
      ['name: dup-query', 'sql: "SELECT 1"', 'columns:', '  - v'].join('\n')
    )
    writeYaml(
      'b-second.yaml',
      ['name: dup-query', 'sql: "SELECT 2"', 'columns:', '  - v'].join('\n')
    )

    const result = loadLocalConfigs(dir)

    expect(result.loaded).toHaveLength(1)
    expect(result.loaded[0].sql).toBe('SELECT 1') // first (alphabetical) file wins
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].file).toBe('b-second.yaml')
    expect(result.skipped[0].error).toContain('Duplicate name')
  })
})
