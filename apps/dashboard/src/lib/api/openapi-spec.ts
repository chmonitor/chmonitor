/**
 * Public OpenAPI document advertised by the RFC 9727 API catalog.
 *
 * Served at GET /api/v1/openapi.json as a real file route (not middleware)
 * so anonymous callers get 200 application/openapi+json instead of a 500
 * from the dashboard shell when no /api/v1 route matches.
 */

export const API_SERVICE_DOC_HREF = 'https://docs.chmonitor.dev/reference/api'

export const OPENAPI_CONTENT_TYPE = 'application/openapi+json'

export const OPENAPI_SPEC_PATH = '/api/v1/openapi.json'

export interface OpenApiDocument {
  openapi: string
  info: {
    title: string
    version: string
    description: string
  }
  externalDocs: {
    description: string
    url: string
  }
  paths: Record<string, unknown>
}

export function buildOpenApiDocument(): OpenApiDocument {
  return {
    openapi: '3.0.0',
    info: {
      title: 'chmonitor API',
      version: '1.0.0',
      description: 'API endpoints for ClickHouse monitoring dashboard.',
    },
    externalDocs: {
      description: 'HTTP API reference',
      url: API_SERVICE_DOC_HREF,
    },
    paths: {
      '/api/health': {
        get: {
          summary: 'Health Check',
          responses: {
            '200': {
              description: 'Success',
            },
          },
        },
      },
      [OPENAPI_SPEC_PATH]: {
        get: {
          summary: 'OpenAPI descriptor',
          responses: {
            '200': {
              description: 'OpenAPI 3.0 document',
            },
          },
        },
      },
    },
  }
}

export function openApiResponse(): Response {
  const body = JSON.stringify(buildOpenApiDocument())
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': OPENAPI_CONTENT_TYPE,
      'Cache-Control': 'public, max-age=60',
    },
  })
}
