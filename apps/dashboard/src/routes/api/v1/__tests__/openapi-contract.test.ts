/**
 * Route-level OpenAPI contract (roadmap 17).
 *
 * Delegates to lib/api/__tests__/openapi-spec.test.ts for the full suite;
 * this file keeps a route-adjacent assertion that the published document
 * cannot collapse to the two-path stub that shipped with #3101.
 */
import { describe, expect, test } from 'bun:test'
import { buildOpenApiDocument } from '@/lib/api/openapi-spec'
import {
  MIN_PUBLIC_API_PATHS,
  REQUIRED_PUBLIC_API_PATHS,
} from '@/lib/api/public-api'

describe('GET /api/v1/openapi.json contract', () => {
  test('documents the real public API, not a 2-path stub', () => {
    const spec = buildOpenApiDocument()
    const paths = Object.keys(spec.paths)
    expect(paths.length).toBeGreaterThan(2)
    expect(paths.length).toBeGreaterThanOrEqual(MIN_PUBLIC_API_PATHS)
    for (const path of REQUIRED_PUBLIC_API_PATHS) {
      expect(spec.paths[path]).toBeDefined()
    }
  })
})
