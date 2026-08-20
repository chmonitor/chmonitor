/**
 * Public OpenAPI document advertised by the RFC 9727 API catalog.
 *
 * Served at GET /api/v1/openapi.json as a real file route (not middleware)
 * so anonymous callers get 200 application/openapi+json instead of a 500
 * from the dashboard shell when no /api/v1 route matches.
 *
 * Paths are assembled from {@link PUBLIC_API_ROUTES} (the live TanStack
 * routes that form the public contract) plus the chart/table registries for
 * `{name}` enums. Internal routes are not listed.
 */

import { getAvailableCharts } from '@/lib/api/chart-registry'
import {
  MIN_PUBLIC_API_PATHS,
  PUBLIC_API_ROUTES,
  type PublicHttpMethod,
} from '@/lib/api/public-api'
import { VALID_INTERVALS } from '@/lib/api/query-executor'
import { getAvailableTables } from '@/lib/api/table-registry'

export const API_SERVICE_DOC_HREF = 'https://docs.chmonitor.dev/reference/api'

export const OPENAPI_CONTENT_TYPE = 'application/openapi+json'

export const OPENAPI_SPEC_PATH = '/api/v1/openapi.json'

export const OPENAPI_VERSION = '3.0.3'

type JsonSchema = Record<string, unknown>

interface OpenApiParameter {
  name: string
  in: 'query' | 'path' | 'header'
  required?: boolean
  description?: string
  schema: JsonSchema
}

interface OpenApiMedia {
  schema: JsonSchema
}

interface OpenApiResponse {
  description: string
  content?: Record<string, OpenApiMedia>
}

interface OpenApiOperation {
  tags: string[]
  summary: string
  description: string
  operationId: string
  security?: Array<Record<string, string[]>>
  parameters?: OpenApiParameter[]
  requestBody?: {
    required?: boolean
    content: Record<string, OpenApiMedia>
  }
  responses: Record<string, OpenApiResponse>
}

interface OpenApiPathItem {
  'x-tanstack-path': string
  [method: string]: unknown
}

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
  servers: Array<{ url: string; description: string }>
  tags: Array<{ name: string; description: string }>
  paths: Record<string, OpenApiPathItem>
  components: {
    securitySchemes: Record<string, JsonSchema>
    schemas: Record<string, JsonSchema>
  }
}

const OPTIONAL_AUTH: Array<Record<string, string[]>> = [{}, { bearerAuth: [] }]
const REQUIRED_AUTH: Array<Record<string, string[]>> = [{ bearerAuth: [] }]

const ref = (name: string): JsonSchema => ({
  $ref: `#/components/schemas/${name}`,
})

function hostIdParam(required: boolean): OpenApiParameter {
  return {
    name: 'hostId',
    in: 'query',
    required,
    description:
      'Zero-based index into the configured host list. Defaults to 0 when omitted (except host-status and overview, which require it).',
    schema: { type: 'integer', minimum: 0, default: 0 },
  }
}

function jsonContent(schema: JsonSchema): Record<string, OpenApiMedia> {
  return { 'application/json': { schema } }
}

function errorResponses(
  extra: Record<string, OpenApiResponse> = {}
): Record<string, OpenApiResponse> {
  return {
    '400': {
      description: 'Validation error',
      content: jsonContent(ref('ErrorBody')),
    },
    '401': {
      description:
        'Authentication required (when the deployment is not fully open)',
      content: jsonContent(ref('ErrorBody')),
    },
    '429': {
      description: 'Rate limited. Retry-After may be set.',
      content: jsonContent(ref('ErrorBody')),
    },
    '500': {
      description: 'Server or query error',
      content: jsonContent(ref('ErrorBody')),
    },
    '503': {
      description: 'Upstream database unreachable or not configured',
      content: jsonContent(ref('ErrorBody')),
    },
    ...extra,
  }
}

function buildOperations(
  chartNames: string[],
  tableNames: string[]
): Record<string, Partial<Record<PublicHttpMethod, OpenApiOperation>>> {
  return {
    '/api/health': {
      get: {
        tags: ['Discovery'],
        summary: 'Liveness',
        description:
          'Anonymous callers receive `{status, timestamp}` only — no deployment metadata. Authenticated callers also receive a `deployment` object (git SHA, auth provider).',
        operationId: 'getHealth',
        security: OPTIONAL_AUTH,
        responses: {
          '200': {
            description: 'Process is up',
            content: jsonContent(ref('HealthResponse')),
          },
        },
      },
    },
    [OPENAPI_SPEC_PATH]: {
      get: {
        tags: ['Discovery'],
        summary: 'OpenAPI descriptor',
        description:
          'This document. Public discovery (RFC 9727 service-desc); exempt from the `/api/v1` auth gate so a client can read the contract before it has credentials.',
        operationId: 'getOpenApiSpec',
        security: [{}],
        responses: {
          '200': {
            description: 'OpenAPI 3.0 document',
            content: {
              [OPENAPI_CONTENT_TYPE]: {
                schema: { type: 'object' },
              },
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
        },
      },
    },
    '/api/v1/hosts': {
      get: {
        tags: ['Hosts'],
        summary: 'List configured hosts',
        description:
          'Sanitized hosts from the dashboard host env (name + URL). Passwords and query strings are stripped. In cloud mode the list is narrowed to the public demo allowlist.',
        operationId: 'listHosts',
        security: OPTIONAL_AUTH,
        responses: {
          '200': {
            description: 'Host list',
            content: jsonContent(ref('HostListResponse')),
          },
          '503': {
            description: 'No hosts configured',
            content: jsonContent(ref('ErrorBody')),
          },
        },
      },
    },
    '/api/v1/host-status': {
      get: {
        tags: ['Hosts'],
        summary: 'Probe one host',
        description:
          'Cheap liveness probe: version, uptime, hostname. Pass `fleet=1` (or the original `counts=1`) to include the optional Fleet metric bundle (counts, live resources, replication, sparkline).',
        operationId: 'getHostStatus',
        security: OPTIONAL_AUTH,
        parameters: [
          hostIdParam(true),
          {
            name: 'fleet',
            in: 'query',
            required: false,
            description: 'Set to `1` to include the Fleet metric bundle.',
            schema: { type: 'string', enum: ['1'] },
          },
          {
            name: 'counts',
            in: 'query',
            required: false,
            description:
              'Original name of the Fleet bundle; treated as `fleet=1`.',
            schema: { type: 'string', enum: ['1'] },
          },
        ],
        responses: {
          '200': {
            description: 'Host status',
            content: jsonContent(ref('HostStatusResponse')),
          },
          ...errorResponses(),
        },
      },
    },
    '/api/v1/overview': {
      get: {
        tags: ['Hosts'],
        summary: 'Overview metrics batch',
        description:
          'Single request for the overview page: running/today query counts, database/table counts, disk usage, and host info.',
        operationId: 'getOverview',
        security: OPTIONAL_AUTH,
        parameters: [hostIdParam(true)],
        responses: {
          '200': {
            description: 'Overview metrics',
            content: jsonContent(ref('OverviewResponse')),
          },
          ...errorResponses(),
        },
      },
    },
    '/api/v1/charts/{name}': {
      get: {
        tags: ['Charts'],
        summary: 'Chart series',
        description:
          'Named chart from the dashboard chart registry. Unknown names return 404 with `availableCharts`. Optional charts whose backing table is missing return 200 with empty data and `metadata.unavailable`.',
        operationId: 'getChart',
        security: OPTIONAL_AUTH,
        parameters: [
          {
            name: 'name',
            in: 'path',
            required: true,
            description: 'Registered chart name.',
            schema:
              chartNames.length > 0
                ? { type: 'string', enum: chartNames }
                : { type: 'string' },
          },
          hostIdParam(false),
          {
            name: 'interval',
            in: 'query',
            required: false,
            description:
              'Time-bucket function (toStartOf*). Invalid values are ignored.',
            schema: { type: 'string', enum: [...VALID_INTERVALS] },
          },
          {
            name: 'lastHours',
            in: 'query',
            required: false,
            description:
              'Lookback window in hours. Capped at 8760 (one year), matching the widest built-in chart.',
            schema: { type: 'integer', minimum: 1, maximum: 8760 },
          },
          {
            name: 'params',
            in: 'query',
            required: false,
            description: 'JSON object of extra chart builder params.',
            schema: { type: 'string' },
          },
          {
            name: 'timezone',
            in: 'query',
            required: false,
            description:
              'IANA timezone for the query session. Invalid values are ignored.',
            schema: { type: 'string', example: 'UTC' },
          },
        ],
        responses: {
          '200': {
            description: 'Chart data (`{success, data, metadata}`)',
            content: jsonContent(ref('ApiEnvelope')),
          },
          '404': {
            description: 'Chart name is not in the registry',
            content: jsonContent(ref('ApiEnvelope')),
          },
          ...errorResponses(),
        },
      },
    },
    '/api/v1/tables': {
      get: {
        tags: ['Tables'],
        summary: 'List tables (autocomplete)',
        description:
          'Lightweight list of non-system, non-temporary tables for autocomplete. Ordered by size. Not the query-config registry — use GET /api/v1/tables/{name} for named dashboard tables.',
        operationId: 'listTables',
        security: OPTIONAL_AUTH,
        parameters: [
          hostIdParam(false),
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Max rows (default 500, max 1000).',
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: 1000,
              default: 500,
            },
          },
        ],
        responses: {
          '200': {
            description: 'Table list',
            content: jsonContent(ref('ApiEnvelope')),
          },
          ...errorResponses(),
        },
      },
    },
    '/api/v1/tables/{name}': {
      get: {
        tags: ['Tables'],
        summary: 'Named table page',
        description:
          'Runs a registered QueryConfig. Extra search params (filters, `page`, `limit`, `sortBy`, `sortOrder`, `pageSize`) are forwarded into the config. Unknown names return 404 with `availableTables`. Optional configs whose backing table is missing return 200 with empty data and `metadata.unavailable`.',
        operationId: 'getTable',
        security: OPTIONAL_AUTH,
        parameters: [
          {
            name: 'name',
            in: 'path',
            required: true,
            description:
              'Registered query-config name (e.g. `running-queries`).',
            schema:
              tableNames.length > 0
                ? { type: 'string', enum: tableNames }
                : { type: 'string' },
          },
          hostIdParam(false),
          {
            name: 'page',
            in: 'query',
            required: false,
            description: 'Page number forwarded to the query config.',
            schema: { type: 'integer', minimum: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Page size forwarded to the query config.',
            schema: { type: 'integer', minimum: 1 },
          },
          {
            name: 'pageSize',
            in: 'query',
            required: false,
            description:
              'Alias used by the Rust CLI; forwarded like other search params.',
            schema: { type: 'integer', minimum: 1 },
          },
          {
            name: 'sortBy',
            in: 'query',
            required: false,
            description: 'Column to sort by, forwarded to the query config.',
            schema: { type: 'string' },
          },
          {
            name: 'sortOrder',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['asc', 'desc'] },
          },
          {
            name: 'search',
            in: 'query',
            required: false,
            description: 'Free-text search forwarded to the query config.',
            schema: { type: 'string' },
          },
          {
            name: 'timezone',
            in: 'query',
            required: false,
            description:
              'IANA timezone for the query session. Invalid values are ignored.',
            schema: { type: 'string', example: 'UTC' },
          },
        ],
        responses: {
          '200': {
            description: 'Table rows (`{success, data, metadata}`)',
            content: jsonContent(ref('ApiEnvelope')),
          },
          '404': {
            description: 'Table config is not in the registry',
            content: jsonContent(ref('ApiEnvelope')),
          },
          ...errorResponses(),
        },
      },
    },
    '/api/v1/findings': {
      get: {
        tags: ['Insights'],
        summary: 'Recent findings',
        description:
          'Recently recorded findings for a host (newest first). Produced by health-sweep cron and the agent `record_finding` tool. Note the host query param is `host`, not `hostId`. Response shape is `{findings, count}`, not the `{success, data}` envelope.',
        operationId: 'listFindings',
        security: OPTIONAL_AUTH,
        parameters: [
          {
            name: 'host',
            in: 'query',
            required: false,
            description:
              'Host id (default 0). Same index space as `hostId` on other routes.',
            schema: { type: 'integer', minimum: 0, default: 0 },
          },
          {
            name: 'severity',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['info', 'warning', 'critical'] },
          },
          {
            name: 'since',
            in: 'query',
            required: false,
            description:
              'Lower time bound as an interval expression, e.g. `24 HOUR` or `7 DAY`.',
            schema: { type: 'string', example: '24 HOUR' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Max findings (default 100, max 1000).',
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: 1000,
              default: 100,
            },
          },
        ],
        responses: {
          '200': {
            description: 'Findings list',
            content: jsonContent(ref('FindingsResponse')),
          },
          ...errorResponses(),
        },
      },
    },
    '/api/v1/agent': {
      post: {
        tags: ['Agent'],
        summary: 'Streaming AI agent',
        description:
          'Natural-language agent over the connected host. Streams UI-message events (Vercel AI SDK). On cloud this is an authenticated feature; self-hosted with `CHM_AUTH_PROVIDER=none` is open. Guest/cloud usage may be metered.',
        operationId: 'runAgent',
        security: REQUIRED_AUTH,
        requestBody: {
          required: true,
          content: jsonContent(ref('AgentRequest')),
        },
        responses: {
          '200': {
            description: 'UI message stream',
            content: {
              'text/event-stream': { schema: { type: 'string' } },
            },
          },
          '400': {
            description: 'Invalid JSON, empty messages, or payload too large',
            content: jsonContent(ref('ErrorBody')),
          },
          '401': {
            description: 'Authentication required',
            content: jsonContent(ref('ErrorBody')),
          },
          '413': {
            description: 'Request body exceeds the 128 KiB limit',
            content: jsonContent(ref('ErrorBody')),
          },
          '429': {
            description: 'Rate limited',
            content: jsonContent(ref('ErrorBody')),
          },
          '503': {
            description: 'Model provider is not configured',
            content: jsonContent(ref('ErrorBody')),
          },
        },
      },
    },
    '/api/mcp': {
      get: {
        tags: ['MCP'],
        summary: 'MCP Streamable HTTP (GET)',
        description:
          'Model Context Protocol endpoint (streamable HTTP). Plan-gated by `api_mcp_access` on cloud; self-hosted is never gated. See the MCP server docs.',
        operationId: 'mcpGet',
        security: OPTIONAL_AUTH,
        responses: {
          '200': {
            description: 'MCP session / SSE',
          },
          '401': { description: 'Authentication required' },
          '429': { description: 'Rate limited' },
        },
      },
      post: {
        tags: ['MCP'],
        summary: 'MCP Streamable HTTP (POST)',
        description:
          'JSON-RPC MCP messages (initialize, tools/list, tools/call, …). Same auth and plan gate as GET.',
        operationId: 'mcpPost',
        security: OPTIONAL_AUTH,
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { type: 'object' } },
          },
        },
        responses: {
          '200': { description: 'MCP JSON-RPC response or stream' },
          '401': { description: 'Authentication required' },
          '429': { description: 'Rate limited' },
        },
      },
      delete: {
        tags: ['MCP'],
        summary: 'MCP session delete',
        description: 'Ends an MCP Streamable HTTP session.',
        operationId: 'mcpDelete',
        security: OPTIONAL_AUTH,
        responses: {
          '200': { description: 'Session ended' },
          '429': { description: 'Rate limited' },
        },
      },
      options: {
        tags: ['MCP'],
        summary: 'CORS preflight',
        description:
          'CORS preflight so cross-origin MCP clients can call this route.',
        operationId: 'mcpOptions',
        security: [{}],
        responses: {
          '204': { description: 'CORS headers' },
        },
      },
    },
    '/api/v1/auth/api-key': {
      post: {
        tags: ['Auth'],
        summary: 'Issue an API key',
        description:
          'Mints a signed `chm_` API key. Authorize with `Authorization: Bearer` set to `CHM_API_KEY_SECRET`, or with an authenticated Clerk/proxy session (user-scoped). Optional `scopes` in the body. Returns 503 when the secret is unset.',
        operationId: 'issueApiKey',
        security: REQUIRED_AUTH,
        requestBody: {
          required: false,
          content: jsonContent(ref('IssueApiKeyRequest')),
        },
        responses: {
          '200': {
            description: 'Minted key',
            content: jsonContent(ref('IssueApiKeyResponse')),
          },
          '400': {
            description: 'Invalid JSON or `days` out of range',
            content: jsonContent(ref('ErrorBody')),
          },
          '401': {
            description: 'Missing secret Bearer or signed-in session',
            content: jsonContent(ref('ErrorBody')),
          },
          '503': {
            description: 'CHM_API_KEY_SECRET is not configured',
            content: jsonContent(ref('ErrorBody')),
          },
        },
      },
    },
    '/api/v1/auth/device/code': {
      post: {
        tags: ['Auth'],
        summary: 'Start device-code login',
        description:
          'RFC 8628 device authorization. Public. Creates a pending device/user code pair for `chm auth login`. Returns 503 when D1 is unavailable.',
        operationId: 'deviceCode',
        security: [{}],
        responses: {
          '200': {
            description: 'Device and user codes',
            content: jsonContent(ref('DeviceCodeResponse')),
          },
          '503': {
            description: 'D1 / device login unavailable',
            content: jsonContent(ref('ErrorBody')),
          },
        },
      },
    },
    '/api/v1/auth/token': {
      post: {
        tags: ['Auth'],
        summary: 'Exchange device code for access token',
        description:
          'Polls a pending device_code. Returns `authorization_pending` (400) until the user approves at `/device`, then mints a `chm_` API key.',
        operationId: 'deviceToken',
        security: [{}],
        requestBody: {
          required: true,
          content: jsonContent(ref('DeviceTokenRequest')),
        },
        responses: {
          '200': {
            description: 'Access token issued',
            content: jsonContent(ref('DeviceTokenResponse')),
          },
          '400': {
            description: 'authorization_pending or other OAuth error',
            content: jsonContent(ref('OAuthError')),
          },
          '503': {
            description: 'CHM_API_KEY_SECRET is not configured',
            content: jsonContent(ref('ErrorBody')),
          },
        },
      },
    },
  }
}

const SCHEMAS: Record<string, JsonSchema> = {
  ErrorBody: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      error: {
        oneOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: {
              type: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'object', additionalProperties: true },
            },
          },
        ],
      },
      metadata: { $ref: '#/components/schemas/ApiMetadata' },
    },
  },
  ApiMetadata: {
    type: 'object',
    properties: {
      queryId: { type: 'string' },
      duration: { type: 'number' },
      rows: { type: 'number' },
      host: { type: 'string' },
      sql: { type: 'string' },
      clickhouseVersion: { type: 'string' }, // pragma: allowlist secret
      timezone: { type: 'string' },
      unavailable: {
        description:
          'Present when an optional backing table is missing or a demo host is hidden.',
        oneOf: [
          { type: 'boolean' },
          {
            type: 'object',
            properties: {
              reason: { type: 'string' },
              message: { type: 'string' },
              missingTables: { type: 'array', items: { type: 'string' } },
            },
          },
        ],
      },
    },
  },
  ApiEnvelope: {
    type: 'object',
    required: ['success'],
    properties: {
      success: { type: 'boolean' },
      data: {},
      metadata: { $ref: '#/components/schemas/ApiMetadata' },
      error: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
  HealthResponse: {
    type: 'object',
    required: ['status', 'timestamp'],
    properties: {
      status: { type: 'string', enum: ['ok', 'error'] },
      timestamp: { type: 'string', format: 'date-time' },
      deployment: {
        type: 'object',
        description: 'Only present for authenticated callers.',
        additionalProperties: true,
      },
    },
  },
  Host: {
    type: 'object',
    required: ['id', 'name', 'host'],
    properties: {
      id: { type: 'integer', minimum: 0 },
      name: { type: 'string' },
      host: { type: 'string', description: 'Sanitized host (no password).' },
    },
  },
  HostListResponse: {
    type: 'object',
    required: ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/Host' },
      },
    },
  },
  HostStatusResponse: {
    type: 'object',
    required: ['success'],
    properties: {
      success: { type: 'boolean' },
      data: {
        type: 'object',
        properties: {
          version: { type: 'string' },
          uptime: { type: 'string' },
          hostname: { type: 'string' },
          databases: { type: 'number' },
          tables: { type: 'number' },
          clusterNodes: { type: 'number' },
          runningQueries: { type: 'number' },
        },
        additionalProperties: true,
      },
      error: { type: 'string' },
      metadata: { $ref: '#/components/schemas/ApiMetadata' },
    },
  },
  OverviewResponse: {
    type: 'object',
    required: ['success'],
    properties: {
      success: { type: 'boolean' },
      data: {
        type: 'object',
        properties: {
          runningQueries: { type: 'number' },
          todayQueries: { type: 'number' },
          databaseCount: { type: 'number' },
          tableCount: { type: 'number' },
          diskUsage: { type: 'object', additionalProperties: true },
          hostInfo: { type: 'object', additionalProperties: true },
        },
      },
      metadata: { type: 'object', additionalProperties: true },
      error: { type: 'string' },
    },
  },
  Finding: {
    type: 'object',
    properties: {
      event_time: { type: 'string' },
      host_id: { type: 'string' },
      severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
      category: { type: 'string' },
      source: { type: 'string' },
      title: { type: 'string' },
      detail: { type: 'string' },
      metric: { type: 'string' },
      value: { type: 'number' },
    },
  },
  FindingsResponse: {
    type: 'object',
    required: ['findings', 'count'],
    properties: {
      findings: {
        type: 'array',
        items: { $ref: '#/components/schemas/Finding' },
      },
      count: { type: 'integer' },
      unavailable: { type: 'object', additionalProperties: true },
    },
  },
  AgentRequest: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Single-turn user message.' },
      messages: {
        type: 'array',
        description: 'UI-message history (max 64).',
        items: { type: 'object', additionalProperties: true },
      },
      hostId: { type: 'integer', minimum: 0, default: 0 },
      model: { type: 'string' },
      apiKey: {
        type: 'string',
        description: 'BYOK model-provider key. Never persisted.',
      },
      disabledTools: { type: 'array', items: { type: 'string' } },
      sessionId: { type: 'string' },
      pageContext: {
        type: 'object',
        properties: {
          route: { type: 'string' },
          label: { type: 'string' },
        },
      },
    },
  },
  IssueApiKeyRequest: {
    type: 'object',
    properties: {
      label: { type: 'string', default: 'cli' },
      days: {
        type: 'integer',
        minimum: 1,
        maximum: 365,
        default: 30,
        description: 'Key lifetime in days.',
      },
      scopes: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional scopes. Empty/omitted stamps all scopes (back-compat).',
      },
    },
  },
  IssueApiKeyResponse: {
    type: 'object',
    required: ['data'],
    properties: {
      data: {
        type: 'object',
        required: ['apiKey', 'sub', 'scopes', 'expiresInDays'],
        properties: {
          apiKey: { type: 'string' },
          sub: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string' } },
          expiresInDays: { type: 'integer' },
        },
      },
    },
  },
  DeviceCodeResponse: {
    type: 'object',
    required: ['data'],
    properties: {
      data: {
        type: 'object',
        required: [
          'device_code',
          'user_code',
          'verification_uri',
          'expires_in',
          'interval',
        ],
        properties: {
          device_code: { type: 'string' },
          user_code: { type: 'string' },
          verification_uri: { type: 'string' },
          verification_uri_complete: { type: 'string' },
          expires_in: { type: 'integer' },
          interval: { type: 'integer' },
        },
      },
    },
  },
  DeviceTokenRequest: {
    type: 'object',
    required: ['grant_type', 'device_code'],
    properties: {
      grant_type: {
        type: 'string',
        description: '`device_code` or the URN form',
      },
      device_code: { type: 'string' },
      client_id: { type: 'string' },
    },
  },
  DeviceTokenResponse: {
    type: 'object',
    required: ['access_token', 'token_type'],
    properties: {
      access_token: { type: 'string' },
      token_type: { type: 'string', enum: ['Bearer'] },
      expires_in: { type: 'integer' },
    },
  },
  OAuthError: {
    type: 'object',
    required: ['error'],
    properties: {
      error: { type: 'string' },
      error_description: { type: 'string' },
    },
  },
}

export function buildOpenApiDocument(): OpenApiDocument {
  const chartNames = [...getAvailableCharts()].sort()
  const tableNames = getAvailableTables()
  const operations = buildOperations(chartNames, tableNames)

  const paths: Record<string, OpenApiPathItem> = {}
  for (const route of PUBLIC_API_ROUTES) {
    const byMethod = operations[route.openapiPath]
    if (!byMethod) {
      throw new Error(
        `OpenAPI operation map is missing path ${route.openapiPath}`
      )
    }
    const item: OpenApiPathItem = {
      'x-tanstack-path': route.tanstackPath,
    }
    for (const method of route.methods) {
      const operation = byMethod[method]
      if (!operation) {
        throw new Error(
          `OpenAPI operation map is missing ${method.toUpperCase()} ${route.openapiPath}`
        )
      }
      item[method] = operation
    }
    paths[route.openapiPath] = item
  }

  if (Object.keys(paths).length < MIN_PUBLIC_API_PATHS) {
    throw new Error(
      `Public OpenAPI spec has ${Object.keys(paths).length} paths; minimum is ${MIN_PUBLIC_API_PATHS}`
    )
  }

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: 'chmonitor API',
      version: '1.0.0',
      description:
        'Public HTTP API for the chmonitor dashboard. This document is the RFC 9727 service-desc at GET /api/v1/openapi.json.\n\nIt lists the stable public contract assembled from the live TanStack Start routes: liveness, host list and status, chart series, table pages, overview, findings, the streaming agent, MCP, and API-key issuance. Internal surfaces (explorer, conversations, billing, webhooks, cron, menu-counts, Slack, health-alert admin, per-user connections) are omitted on purpose.',
    },
    externalDocs: {
      description: 'HTTP API reference',
      url: API_SERVICE_DOC_HREF,
    },
    servers: [
      {
        url: '/',
        description: 'Same origin as the dashboard',
      },
    ],
    tags: [
      { name: 'Discovery', description: 'Catalog, OpenAPI, liveness' },
      {
        name: 'Hosts',
        description: 'Configured hosts and overview',
      },
      {
        name: 'Charts',
        description: 'Named chart series from the chart registry',
      },
      {
        name: 'Tables',
        description: 'Named QueryConfig tables and autocomplete',
      },
      { name: 'Insights', description: 'Persisted findings' },
      { name: 'Agent', description: 'Streaming AI agent' },
      { name: 'MCP', description: 'Model Context Protocol' },
      { name: 'Auth', description: 'API-key issuance and device-code login' },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'chm_',
          description:
            'Signed `chm_` API key (`Authorization: Bearer chm_…`) or a Clerk session on cloud. Self-hosted with CHM_AUTH_PROVIDER=none and no CHM_API_KEY_SECRET is fully open.',
        },
      },
      schemas: SCHEMAS,
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
