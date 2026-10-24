/**
 * Release-please config must stay consistent with the files it bumps.
 *
 * Each case encodes a failure that blocked or broke the v0.3.9 release:
 *   - the `generic` updater bumps only the FIRST version on a line, so a README
 *     release block with two versions on one line left the second stale (#4183);
 *   - the rust release PR bumps Cargo.toml but not rust/Cargo.lock, so
 *     `cargo publish --locked` failed until the publish step ran
 *     `cargo update -p chmonitor` first (#4187);
 *   - a manifest that disagrees with its config, or with the version in the
 *     package's own file, makes release-please compute the wrong next version.
 *
 * The third v0.3.9 failure (a merged release PR stuck on `autorelease: pending`)
 * is live GitHub state, not repo state: see scripts/check-release-labels.sh.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const RP_DIR = join(ROOT, '.github/release-please')

interface ExtraFile {
  type: string
  path: string
  jsonpath?: string
}
interface PackageConfig {
  'release-type': string
  'extra-files'?: (ExtraFile | string)[]
}
interface RpConfig {
  packages: Record<string, PackageConfig>
}

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const components = readdirSync(RP_DIR)
  .filter((f) => f.endsWith('-config.json'))
  .map((f) => f.replace(/-config\.json$/, ''))

function loadPair(name: string) {
  const config = JSON.parse(
    readFileSync(join(RP_DIR, `${name}-config.json`), 'utf8')
  ) as RpConfig
  const manifest = JSON.parse(
    readFileSync(join(RP_DIR, `${name}-manifest.json`), 'utf8')
  ) as Record<string, string>
  return { config, manifest }
}

const SEMVER = /\bv?\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\b/g

/** Lines inside x-release-please-start-version..end that carry 2+ versions. */
function multiVersionLines(text: string): string[] {
  const bad: string[] = []
  let inside = false
  for (const line of text.split('\n')) {
    if (line.includes('x-release-please-start-version')) {
      inside = true
      continue
    }
    if (line.includes('x-release-please-end')) {
      inside = false
      continue
    }
    if (inside && (line.match(SEMVER) ?? []).length > 1) bad.push(line)
  }
  return bad
}

/** True when `cargo update -p chmonitor` runs before `cargo publish`. */
function syncsLockBeforePublish(workflow: string): boolean {
  const update = workflow.indexOf('cargo update -p chmonitor')
  const publish = workflow.indexOf('cargo publish')
  return update !== -1 && publish !== -1 && update < publish
}

/** The version declared in a package's own file, by release type. */
function ownVersion(
  pkgPath: string,
  pkg: PackageConfig
): { file: string; version: string | undefined } {
  switch (pkg['release-type']) {
    case 'helm': {
      const file = join(pkgPath, 'Chart.yaml')
      return { file, version: read(file).match(/^version:\s*(\S+)/m)?.[1] }
    }
    case 'rust': {
      const file = join(pkgPath, 'Cargo.toml')
      return {
        file,
        version: read(file).match(/^version\s*=\s*"([^"]+)"/m)?.[1],
      }
    }
    default: {
      const json = (pkg['extra-files'] ?? []).find(
        (f): f is ExtraFile => typeof f !== 'string' && f.type === 'json'
      )
      if (!json) throw new Error(`no json extra-file for ${pkgPath}`)
      const file = join(pkgPath, json.path)
      return {
        file,
        version: (JSON.parse(read(file)) as { version?: string }).version,
      }
    }
  }
}

describe('release-please config', () => {
  test('finds the three component pairs', () => {
    expect(components.sort()).toEqual(['cli', 'dashboard', 'helm'])
  })

  for (const name of components) {
    test(`${name}: manifest package paths match config package paths`, () => {
      const { config, manifest } = loadPair(name)
      expect(Object.keys(manifest).sort()).toEqual(
        Object.keys(config.packages).sort()
      )
    })

    test(`${name}: manifest version equals the package's own version`, () => {
      const { config, manifest } = loadPair(name)
      for (const [pkgPath, pkg] of Object.entries(config.packages)) {
        const { file, version } = ownVersion(pkgPath, pkg)
        expect({ file, version }).toEqual({ file, version: manifest[pkgPath] })
      }
    })

    test(`${name}: generic extra-file blocks hold one version per line`, () => {
      const { config } = loadPair(name)
      for (const [pkgPath, pkg] of Object.entries(config.packages)) {
        for (const f of pkg['extra-files'] ?? []) {
          if (typeof f === 'string' || f.type !== 'generic') continue
          const text = read(join(pkgPath, f.path))
          expect(text).toContain('x-release-please-start-version')
          expect({ file: f.path, lines: multiVersionLines(text) }).toEqual({
            file: f.path,
            lines: [],
          })
        }
      }
    })
  }

  test('dashboard bumps README.md with the generic updater', () => {
    const { config } = loadPair('dashboard')
    const extra = config.packages['.']?.['extra-files'] ?? []
    expect(extra).toContainEqual({ type: 'generic', path: 'README.md' })
  })

  test('CLI publish syncs Cargo.lock before cargo publish --locked', () => {
    expect(
      syncsLockBeforePublish(read('.github/workflows/cli-rust-release.yml'))
    ).toBe(true)
  })
})

describe('checks reject the v0.3.9 failure shapes', () => {
  test('two versions on one line inside a block', () => {
    const block = (body: string) =>
      `<!-- x-release-please-start-version -->\n${body}\n<!-- x-release-please-end -->`
    expect(
      multiVersionLines(block('Current: v0.3.9 (image 0.3.8)'))
    ).toHaveLength(1)
    expect(multiVersionLines(block('Current: v0.3.9'))).toEqual([])
    expect(multiVersionLines('outside v0.3.9 and v0.3.8')).toEqual([])
  })

  test('publish without, or before, the lock sync', () => {
    expect(syncsLockBeforePublish('cargo publish -p chmonitor --locked')).toBe(
      false
    )
    expect(
      syncsLockBeforePublish(
        'cargo publish --locked\ncargo update -p chmonitor'
      )
    ).toBe(false)
  })
})
