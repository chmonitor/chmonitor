/**
 * Public OpenAPI contract.
 *
 * Guards the #3088 follow-up: GET /api/v1/openapi.json must document the real
 * public HTTP API (hosts, charts, tables, …), not a 2-path stub of /api/health
 * + itself. Also asserts every advertised path has a committed route module
 * under src/routes/api/ so we do not invent endpoints. Do not read
 * routeTree.gen.ts — that file is generated and absent from the CI unit-test job.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAvailableCharts } from '@/lib/api/chart-registry'
import {
  buildOpenApiDocument,
  OPENAPI_CONTENT_TYPE,
  OPENAPI_SPEC_PATH,
  OPENAPI_VERSION,
  openApiResponse,
} from '@/lib/api/openapi-spec'
import {
  listPublicOpenApiPaths,
  MIN_PUBLIC_API_PATHS,
  PUBLIC_API_ROUTES,
  REQUIRED_PUBLIC_API_PATHS,
  tanstackPathToOpenApiPath,
} from '@/lib/api/public-api'
import { getAvailableTables } from '@/lib/api/table-registry'

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
] as const

/** Collect createFileRoute('/api/...') paths from committed route modules. */
function collectApiFileRoutes(dir: string): Set<string> {
  const paths = new Set<string>()

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue
        walk(full)
        continue
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue
      if (entry.name.includes('.test.')) continue
      const source = readFileSync(full, 'utf8')
      const routeRe = /createFileRoute\('(\/api[^']*)'\)/g
      let match: RegExpExecArray | null = routeRe.exec(source)
      while (match) {
        paths.add(match[1])
        match = routeRe.exec(source)
      }
    }
  }

  walk(dir)
  return paths
}

function isOpenApi30(doc: { openapi: string }): boolean {
  return /^3\.0\.\d+$/.test(doc.openapi)
}

describe('public OpenAPI spec', () => {
  const spec = buildOpenApiDocument()
  const pathKeys = Object.keys(spec.paths)

  test('is OpenAPI 3.0 JSON with info and paths', () => {
    expect(isOpenApi30(spec)).toBe(true)
    expect(spec.openapi).toBe(OPENAPI_VERSION)
    expect(spec.info.title).toBe('chmonitor API')
    expect(spec.info.version).toBeTruthy()
    expect(spec.info.description).toContain('public')
    expect(spec.externalDocs.url).toContain('/reference/api')
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined()
  })

  test('lists more than two paths (not a health+self stub)', () => {
    expect(pathKeys.length).toBeGreaterThan(2)
    expect(pathKeys.length).toBeGreaterThanOrEqual(MIN_PUBLIC_API_PATHS)
    expect(pathKeys.length).toBe(PUBLIC_API_ROUTES.length)
  })

  test('includes the stable public surface', () => {
    for (const path of REQUIRED_PUBLIC_API_PATHS) {
      expect(spec.paths[path]).toBeDefined()
    }
    expect(spec.paths['/api/v1/hosts']?.get).toBeDefined()
    expect(spec.paths['/api/v1/charts/{name}']?.get).toBeDefined()
    expect(spec.paths['/api/v1/tables/{name}']?.get).toBeDefined()
    expect(spec.paths['/api/v1/tables']?.get).toBeDefined()
    expect(spec.paths['/api/v1/findings']?.get).toBeDefined()
    expect(spec.paths['/api/v1/agent']?.post).toBeDefined()
    expect(spec.paths['/api/mcp']?.post).toBeDefined()
    expect(spec.paths['/api/v1/auth/api-key']?.post).toBeDefined()
  })

  test('paths match the public-api catalog exactly', () => {
    expect(pathKeys.sort()).toEqual([...listPublicOpenApiPaths()].sort())
  })

  test('every path item has at least one HTTP method and responses', () => {
    for (const [path, item] of Object.entries(spec.paths)) {
      const methods = HTTP_METHODS.filter((method) => item[method] != null)
      expect(methods.length, `${path} has no HTTP methods`).toBeGreaterThan(0)
      for (const method of methods) {
        const operation = item[method] as {
          responses?: Record<string, unknown>
        }
        expect(
          operation.responses,
          `${method.toUpperCase()} ${path}`
        ).toBeDefined()
        expect(Object.keys(operation.responses ?? {}).length).toBeGreaterThan(0)
      }
    }
  })

  test('does not advertise internal surfaces', () => {
    const advertised = pathKeys.join('\n')
    expect(advertised).not.toContain('/explorer')
    expect(advertised).not.toContain('/billing')
    expect(advertised).not.toContain('/webhooks')
    expect(advertised).not.toContain('/cron')
    expect(advertised).not.toContain('/menu-counts')
    expect(advertised).not.toContain('/conversations')
    expect(advertised).not.toContain('/user-connections')
  })

  test('chart and table path params use the live registries', () => {
    const charts = [...getAvailableCharts()].sort()
    const tables = getAvailableTables()
    expect(charts.length).toBeGreaterThanOrEqual(100)
    expect(tables.length).toBeGreaterThanOrEqual(50)

    const chartParam = (
      spec.paths['/api/v1/charts/{name}']?.get as {
        parameters: Array<{ name: string; schema: { enum?: string[] } }>
      }
    ).parameters.find((p) => p.name === 'name')
    const tableParam = (
      spec.paths['/api/v1/tables/{name}']?.get as {
        parameters: Array<{ name: string; schema: { enum?: string[] } }>
      }
    ).parameters.find((p) => p.name === 'name')

    expect(chartParam?.schema.enum).toEqual(charts)
    expect(tableParam?.schema.enum).toEqual(tables)
    expect(chartParam?.schema.enum).toContain('query-count')
    expect(tableParam?.schema.enum).toContain('running-queries')
  })

  test('every catalog path exists as a committed API route module', () => {
    const routesDir = fileURLToPath(
      new URL('../../../routes/api', import.meta.url)
    )
    const live = collectApiFileRoutes(routesDir)
    expect(live.size).toBeGreaterThan(MIN_PUBLIC_API_PATHS)

    for (const route of PUBLIC_API_ROUTES) {
      expect(live.has(route.tanstackPath), route.tanstackPath).toBe(true)
      expect(tanstackPathToOpenApiPath(route.tanstackPath)).toBe(
        route.openapiPath
      )
      expect(spec.paths[route.openapiPath]?.['x-tanstack-path']).toBe(
        route.tanstackPath
      )
    }
  })

  test('openApiResponse is 200 application/openapi+json', async () => {
    const res = openApiResponse()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(OPENAPI_CONTENT_TYPE)
    const body = (await res.json()) as {
      openapi: string
      paths: Record<string, unknown>
    }
    expect(isOpenApi30(body)).toBe(true)
    expect(Object.keys(body.paths).length).toBeGreaterThan(2)
    expect(body.paths[OPENAPI_SPEC_PATH]).toBeDefined()
    expect(body.paths['/api/v1/hosts']).toBeDefined()
  })
})
