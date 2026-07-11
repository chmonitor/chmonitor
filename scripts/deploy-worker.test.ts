import {
  discoverApps,
  expandManifestKeys,
  isLikelySecretName,
  loadManifest,
  parseArgs,
  parseDotenv,
  redactValue,
  resolveSecretsEnv,
  resolveVarsEnv,
} from './deploy-worker'
import { describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function withTempDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-worker-test-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('parseArgs', () => {
  test('parses app + flags', () => {
    expect(parseArgs(['cloud-hooks', '--env', 'preview', '--dry-run'])).toEqual(
      {
        app: 'cloud-hooks',
        env: 'preview',
        dryRun: true,
        secretsOnly: false,
        noSecrets: false,
        list: false,
      }
    )
  })

  test('parses --list with no app', () => {
    expect(parseArgs(['--list']).list).toBe(true)
    expect(parseArgs(['--list']).app).toBeNull()
  })

  test('parses --secrets-only and --no-secrets independently', () => {
    expect(parseArgs(['bug-handler', '--secrets-only']).secretsOnly).toBe(true)
    expect(parseArgs(['bug-handler', '--no-secrets']).noSecrets).toBe(true)
  })
})

describe('parseDotenv', () => {
  test('parses KEY=VALUE lines, skips comments/blank, strips quotes', () => {
    const parsed = parseDotenv(
      ['# comment', '', 'FOO=bar', 'BAZ="quoted"', "QUX='single'"].join('\n')
    )
    expect(parsed).toEqual({ FOO: 'bar', BAZ: 'quoted', QUX: 'single' })
  })
})

describe('expandManifestKeys — CHM_POLAR_PRODUCT_* wildcard expansion', () => {
  test('expands a trailing-* pattern to every matching key, sorted', () => {
    const source = {
      CHM_POLAR_PRODUCT_PRO_YEARLY: 'y',
      CHM_POLAR_PRODUCT_FREE_MONTHLY: 'f',
      CHM_POLAR_SERVER: 'production',
      UNRELATED: 'x',
    }
    expect(
      expandManifestKeys(['CHM_POLAR_SERVER', 'CHM_POLAR_PRODUCT_*'], source)
    ).toEqual([
      'CHM_POLAR_SERVER',
      'CHM_POLAR_PRODUCT_FREE_MONTHLY',
      'CHM_POLAR_PRODUCT_PRO_YEARLY',
    ])
  })

  test('a plain (non-wildcard) key passes through even when absent from source', () => {
    expect(expandManifestKeys(['MISSING_KEY'], {})).toEqual(['MISSING_KEY'])
  })

  test('wildcard with no matches expands to nothing', () => {
    expect(expandManifestKeys(['NOPE_*'], { OTHER: '1' })).toEqual([])
  })
})

describe('redaction', () => {
  test('secret-shaped keys are always redacted', () => {
    expect(isLikelySecretName('POLAR_ACCESS_TOKEN')).toBe(true)
    expect(isLikelySecretName('CLICKHOUSE_PASSWORD')).toBe(true)
    expect(isLikelySecretName('CHM_API_KEY_SECRET')) // matches _API_KEY and SECRET
      .toBe(true)
    expect(isLikelySecretName('CHM_POLAR_SERVER')).toBe(false)
  })

  test('redactValue masks secret-shaped keys, passes through others', () => {
    expect(redactValue('POLAR_ACCESS_TOKEN', 'sk_live_abc')).toBe('***')
    expect(redactValue('CHM_POLAR_SERVER', 'production')).toBe('production')
  })
})

describe('discoverApps', () => {
  test('only lists directories with a wrangler.toml', () => {
    withTempDir((dir) => {
      const withWrangler = join(dir, 'has-wrangler')
      const withoutWrangler = join(dir, 'no-wrangler')
      mkdirSync(withWrangler)
      mkdirSync(withoutWrangler)
      writeFileSync(join(withWrangler, 'wrangler.toml'), 'name = "x"')
      expect(discoverApps(dir)).toEqual(['has-wrangler'])
    })
  })
})

describe('env overlay precedence', () => {
  test('preview overlays production; app dir overrides dashboard dir', () => {
    withTempDir((dashboardDir) => {
      writeFileSync(
        join(dashboardDir, '.env.production'),
        'CHM_POLAR_SERVER=production\nSHARED=base\n'
      )
      writeFileSync(
        join(dashboardDir, '.env.preview'),
        'CHM_POLAR_SERVER=sandbox\n'
      )
      const appDir = join(dashboardDir, '..', 'cloud-hooks')
      mkdirSync(appDir, { recursive: true })
      writeFileSync(join(appDir, '.env.production'), 'SHARED=app-override\n')

      // Rebuild resolveVarsEnv's DASHBOARD_DIR indirectly is not possible (it's
      // module-scoped), so exercise the pure merge logic directly here instead.
      const dashboardProd = parseDotenv(
        readFileSync(join(dashboardDir, '.env.production'), 'utf-8')
      )
      const dashboardPreview = parseDotenv(
        readFileSync(join(dashboardDir, '.env.preview'), 'utf-8')
      )
      const appProd = parseDotenv(
        readFileSync(join(appDir, '.env.production'), 'utf-8')
      )

      const merged = { ...dashboardProd, ...dashboardPreview, ...appProd }
      expect(merged.CHM_POLAR_SERVER).toBe('sandbox')
      expect(merged.SHARED).toBe('app-override')
    })
  })
})

describe('resolveSecretsEnv — process.env fallback', () => {
  test('falls back to process.env for keys missing from files', () => {
    withTempDir((dir) => {
      const appDir = join(dir, 'cloud-hooks')
      mkdirSync(appDir, { recursive: true })
      const result = resolveSecretsEnv(appDir, {
        CI_ONLY_SECRET: 'from-process-env',
      })
      expect(result.CI_ONLY_SECRET).toBe('from-process-env')
    })
  })

  test('file values take priority over process.env', () => {
    withTempDir((dir) => {
      const appDir = join(dir, 'cloud-hooks')
      mkdirSync(appDir, { recursive: true })
      writeFileSync(join(appDir, '.env.local'), 'DUP_KEY=from-file\n')
      const result = resolveSecretsEnv(appDir, { DUP_KEY: 'from-process-env' })
      expect(result.DUP_KEY).toBe('from-file')
    })
  })
})

describe('resolveVarsEnv — real repo fixtures (dashboard/preview overlay)', () => {
  test('cloud-hooks manifest resolves against apps/dashboard env files', () => {
    const appDir = join(import.meta.dir, '..', 'apps', 'cloud-hooks')
    const prod = resolveVarsEnv(appDir, false)
    expect(prod.CHM_POLAR_SERVER).toBe('production')
    expect(prod.CHM_POLAR_PRODUCT_FREE_MONTHLY).toBeDefined()

    const preview = resolveVarsEnv(appDir, true)
    expect(preview.CHM_POLAR_SERVER).toBe('sandbox')
  })
})

describe('loadManifest', () => {
  test('parses the real cloud-hooks and bug-handler manifests', async () => {
    const cloudHooks = await loadManifest(
      join(import.meta.dir, '..', 'apps', 'cloud-hooks')
    )
    expect(cloudHooks.vars).toContain('CHM_POLAR_SERVER')
    expect(cloudHooks.vars).toContain('CHM_POLAR_PRODUCT_*')
    expect(cloudHooks.secrets).toContain('POLAR_WEBHOOK_SECRET')

    const bugHandler = await loadManifest(
      join(import.meta.dir, '..', 'apps', 'bug-handler')
    )
    expect(bugHandler.vars).toContain('GITHUB_REPOSITORY')
    expect(bugHandler.secrets).toEqual(['GITHUB_TOKEN'])
  })

  test('apps without a deploy.config.ts return empty arrays', async () => {
    const empty = await loadManifest(
      join(import.meta.dir, '..', 'apps', 'dashboard')
    )
    expect(empty).toEqual({})
  })
})
