/**
 * Tests for the community query-pack registry (Plan 54).
 *
 * `loadPacks` and `parsePackRegistryUrls` are the stable, directly-testable
 * contracts — same rationale as `local-loader.test.ts` (plan 55): the
 * memoized `ensurePacksLoaded` / `getPackCatalogSnapshot` singleton is wired
 * through `getQueryConfigByName`'s `import.meta.env.SSR` branch, which isn't
 * statically folded under plain `bun:test`, so asserting through that seam
 * would test the wrong thing.
 *
 * HTTP fetches are stubbed (no real network/DNS) via an injected `fetchImpl`;
 * `file://` cases use real temp files on disk, matching local-loader.test.ts.
 */

import { loadPacks, parsePackRegistryUrls } from './pack-registry'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

function writeTempYaml(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'chm-pack-registry-'))
  const filePath = join(dir, 'pack.yaml')
  writeFileSync(filePath, contents, 'utf-8')
  return pathToFileURL(filePath).href
}

function okResponse(text: string): Response {
  return new Response(text, { status: 200 })
}

const VALID_PACK = [
  'name: community-pack',
  'version: "1.0.0"',
  'queries:',
  '  - name: my-pack-query',
  '    sql: "SELECT 1"',
  '    columns:',
  '      - value',
].join('\n')

// ---------------------------------------------------------------------------
// parsePackRegistryUrls
// ---------------------------------------------------------------------------

describe('parsePackRegistryUrls', () => {
  test('returns [] with no env set', () => {
    expect(parsePackRegistryUrls({})).toEqual([])
  })

  test('returns [] for an empty string value', () => {
    expect(parsePackRegistryUrls({ CHM_PACK_REGISTRY_URL: '' })).toEqual([])
  })

  test('parses a single URL', () => {
    expect(
      parsePackRegistryUrls({
        CHM_PACK_REGISTRY_URL: 'https://example.com/pack.yaml',
      })
    ).toEqual(['https://example.com/pack.yaml'])
  })

  test('splits comma-separated URLs and trims whitespace', () => {
    expect(
      parsePackRegistryUrls({
        CHM_PACK_REGISTRY_URL:
          ' https://example.com/a.yaml , file:///etc/pack-b.yaml ,,',
      })
    ).toEqual(['https://example.com/a.yaml', 'file:///etc/pack-b.yaml'])
  })
})

// ---------------------------------------------------------------------------
// loadPacks — the plan's stated scenarios
// ---------------------------------------------------------------------------

describe('loadPacks', () => {
  test('empty url list resolves to an empty catalog, no I/O', async () => {
    const result = await loadPacks([], () => {
      throw new Error('fetchImpl must not be called')
    })
    expect(result).toEqual({ catalog: {}, skipped: [] })
  })

  test('a valid HTTP pack merges and its query appears in the catalog', async () => {
    const fetchImpl = (async () =>
      okResponse(VALID_PACK)) as unknown as typeof fetch

    const result = await loadPacks(
      ['https://packs.example.com/pack.yaml'],
      fetchImpl
    )

    expect(result.skipped).toEqual([])
    expect(result.catalog['my-pack-query']).toBeDefined()
    expect(result.catalog['my-pack-query'].sql).toBe('SELECT 1')
  })

  test('a valid file:// pack loads and its query appears in the catalog', async () => {
    const url = writeTempYaml(VALID_PACK)
    const dir = join(url.replace('file://', ''), '..')

    try {
      const result = await loadPacks([url])

      expect(result.skipped).toEqual([])
      expect(result.catalog['my-pack-query']).toBeDefined()
      expect(result.catalog['my-pack-query'].columns).toEqual(['value'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('an unreachable pack (fetch throws) fails closed to an empty catalog', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch

    const result = await loadPacks(
      ['https://down.example.com/pack.yaml'],
      fetchImpl
    )

    expect(result.catalog).toEqual({})
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].source).toBe('https://down.example.com/pack.yaml')
    expect(result.skipped[0].error).toContain('Could not fetch pack')
  })

  test('a non-2xx HTTP response is treated as unreachable', async () => {
    const fetchImpl = (async () =>
      new Response('not found', { status: 404 })) as unknown as typeof fetch

    const result = await loadPacks(
      ['https://example.com/missing.yaml'],
      fetchImpl
    )

    expect(result.catalog).toEqual({})
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].error).toContain('404')
  })

  test('invalid YAML syntax rejects the whole pack, never throws', async () => {
    const fetchImpl = (async () =>
      okResponse('name: broken\n  sql: "SELECT 1')) as unknown as typeof fetch

    let result: Awaited<ReturnType<typeof loadPacks>> | undefined
    await expect(
      (async () => {
        result = await loadPacks(['https://example.com/broken.yaml'], fetchImpl)
      })()
    ).resolves.toBeUndefined()

    expect(result!.catalog).toEqual({})
    expect(result!.skipped).toHaveLength(1)
    expect(result!.skipped[0].error).toContain('Invalid YAML')
  })

  test('a manifest missing required fields rejects the whole pack', async () => {
    const fetchImpl = (async () =>
      okResponse(
        'description: "no name, version, or queries"'
      )) as unknown as typeof fetch

    const result = await loadPacks(
      ['https://example.com/no-manifest.yaml'],
      fetchImpl
    )

    expect(result.catalog).toEqual({})
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].error).toContain('Invalid pack manifest')
  })

  test('one invalid query in an otherwise-valid pack is skipped; valid entries still merge', async () => {
    const mixedPack = [
      'name: mixed-pack',
      'version: "1.0.0"',
      'queries:',
      '  - name: good-query',
      '    sql: "SELECT 1"',
      '    columns:',
      '      - value',
      '  - name: bad-query',
      '    sql: "SELECT 2"', // missing required `columns`
    ].join('\n')
    const fetchImpl = (async () =>
      okResponse(mixedPack)) as unknown as typeof fetch

    const result = await loadPacks(
      ['https://example.com/mixed.yaml'],
      fetchImpl
    )

    expect(result.catalog['good-query']).toBeDefined()
    expect(result.catalog['bad-query']).toBeUndefined()
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].source).toContain('queries[1]')
  })

  test('a later URL wins on a name collision (last pack wins)', async () => {
    const first = [
      'name: pack-a',
      'version: "1.0.0"',
      'queries:',
      '  - name: shared-query',
      '    sql: "SELECT 1"',
      '    columns:',
      '      - value',
    ].join('\n')
    const second = [
      'name: pack-b',
      'version: "2.0.0"',
      'queries:',
      '  - name: shared-query',
      '    sql: "SELECT 2"',
      '    columns:',
      '      - value',
    ].join('\n')

    let call = 0
    const fetchImpl = (async () => {
      call += 1
      return okResponse(call === 1 ? first : second)
    }) as unknown as typeof fetch

    const result = await loadPacks(
      ['https://example.com/a.yaml', 'https://example.com/b.yaml'],
      fetchImpl
    )

    expect(result.catalog['shared-query'].sql).toBe('SELECT 2')
  })

  test('an unreachable pack among several does not block the others from loading', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('down')) {
        throw new Error('ECONNREFUSED')
      }
      return okResponse(VALID_PACK)
    }) as unknown as typeof fetch

    const result = await loadPacks(
      [
        'https://down.example.com/pack.yaml',
        'https://up.example.com/pack.yaml',
      ],
      fetchImpl
    )

    expect(result.catalog['my-pack-query']).toBeDefined()
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].source).toBe('https://down.example.com/pack.yaml')
  })
})
