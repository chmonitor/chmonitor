/**
 * CHM_CONFIG_FILE (#3494). The docs teach operators to mount a TOML/YAML file
 * and point CHM_CONFIG_FILE at it; before this loader existed the file was
 * silently ignored. These tests pin the contract: the file overrides built-in
 * defaults, env vars still win over it, and a bad or absent file never breaks
 * config resolution (it lands in skipped[] or is a no-op).
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

mock.module('cloudflare:workers', () => ({ env: {} }))

const { loadFeatureConfigFile, _resetFileFeatureOverridesCache } = await import(
  '../config-file'
)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chm-config-file-'))
function write(name: string, body: string): string {
  const file = path.join(dir, name)
  fs.writeFileSync(file, body)
  return file
}

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('loadFeatureConfigFile', () => {
  test('reads the documented TOML shape', () => {
    const file = write(
      'config.toml',
      `# comment
[features.agent]
enabled = true
access = "authenticated"

[features.metrics]
access = "guest" # alias for public

[features.settings]
enabled = false
`
    )
    expect(loadFeatureConfigFile(file)).toEqual({
      features: {
        agent: { enabled: true, access: 'authenticated' },
        metrics: { access: 'public' },
        settings: { enabled: false },
      },
      skipped: [],
    })
  })

  test('reads the documented YAML shape', () => {
    const file = write(
      'config.yaml',
      'features:\n  agent:\n    access: authenticated\n  settings:\n    enabled: false\n'
    )
    expect(loadFeatureConfigFile(file).features).toEqual({
      agent: { access: 'authenticated' },
      settings: { enabled: false },
    })
  })

  test('absent path or file is a silent no-op', () => {
    expect(loadFeatureConfigFile(undefined)).toEqual({
      features: {},
      skipped: [],
    })
    expect(loadFeatureConfigFile(path.join(dir, 'missing.toml'))).toEqual({
      features: {},
      skipped: [],
    })
  })

  test('malformed file lands in skipped[] and never throws', () => {
    const yaml = write('bad.yaml', 'features: [unclosed')
    const toml = write('bad.toml', '[features.agent]\nenabled = maybe\n')
    for (const file of [yaml, toml]) {
      const result = loadFeatureConfigFile(file)
      expect(result.features).toEqual({})
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0].entry).toBe('file')
    }
  })

  test('an invalid entry is skipped, the valid ones still apply', () => {
    const file = write(
      'mixed.yaml',
      'features:\n  nope:\n    enabled: false\n  agent:\n    access: root\n  logs:\n    enabled: false\n'
    )
    const result = loadFeatureConfigFile(file)
    expect(result.features).toEqual({ logs: { enabled: false } })
    expect(result.skipped.map((s) => s.entry)).toEqual([
      'features.nope',
      'features.agent',
    ])
  })
})

describe('getAppConfig layering', () => {
  const KEYS = ['CHM_CONFIG_FILE', 'CHM_FEATURE_AGENT_ACCESS', 'SSR']

  async function reset() {
    for (const key of KEYS) delete process.env[key]
    _resetFileFeatureOverridesCache()
    const { _resetAppConfigCache } = await import('../server')
    _resetAppConfigCache()
  }

  beforeEach(reset)
  afterEach(reset)

  // In bun, import.meta.env aliases process.env, so SSR is set here to take
  // the server branch that Vite keeps in the SSR build.
  test('file overrides defaults; env var wins over the file', async () => {
    process.env.SSR = 'true'
    process.env.CHM_CONFIG_FILE = write(
      'layer.toml',
      '[features.agent]\naccess = "authenticated"\n[features.logs]\nenabled = false\n'
    )
    process.env.CHM_FEATURE_AGENT_ACCESS = 'public'
    const { getAppConfig } = await import('../server')
    expect(getAppConfig().features).toEqual({
      agent: { access: 'public' },
      logs: { enabled: false },
    })
  })

  test('malformed file does not break resolution', async () => {
    process.env.SSR = 'true'
    process.env.CHM_CONFIG_FILE = write('broken.toml', 'not toml at all')
    const { getAppConfig } = await import('../server')
    expect(getAppConfig().features).toEqual({})
  })
})
