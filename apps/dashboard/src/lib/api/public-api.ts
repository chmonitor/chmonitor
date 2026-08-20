/**
 * Stable public HTTP API surface.
 *
 * This is the contract advertised by GET /api/v1/openapi.json — assembled from
 * the TanStack Start routes that already exist, not invented. Internal
 * surfaces (explorer/*, conversations/*, billing/*, webhooks/*, cron/*,
 * menu-counts/*, Slack, health-alert admin, user-connections) stay out.
 *
 * Each entry maps an OpenAPI path to a committed `createFileRoute(...)` under
 * `src/routes/api/`. Tests fail if a catalog path has no matching route
 * module, or if the published spec shrinks back to a 2-path stub.
 */

export type PublicHttpMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'options'

export interface PublicApiRoute {
  /** Path as advertised in OpenAPI (brace params, no trailing slash). */
  readonly openapiPath: string
  /** Path registered on the TanStack file route (`$name`, trailing slash ok). */
  readonly tanstackPath: string
  readonly methods: readonly PublicHttpMethod[]
}

/**
 * Convert a TanStack file-route path to the OpenAPI form:
 * `$name` → `{name}`, trailing slash stripped.
 */
export function tanstackPathToOpenApiPath(tanstackPath: string): string {
  const braced = tanstackPath.replace(/\$([A-Za-z0-9_]+)/g, '{$1}')
  if (braced.length > 1 && braced.endsWith('/')) {
    return braced.slice(0, -1)
  }
  return braced
}

/**
 * The public contract. Order is the order paths appear in the OpenAPI
 * document. Keep this list in sync with the operation map in openapi-spec.ts.
 */
export const PUBLIC_API_ROUTES = [
  {
    openapiPath: '/api/health',
    tanstackPath: '/api/health',
    methods: ['get'],
  },
  {
    openapiPath: '/api/v1/openapi.json',
    tanstackPath: '/api/v1/openapi.json',
    methods: ['get'],
  },
  {
    openapiPath: '/api/v1/hosts',
    tanstackPath: '/api/v1/hosts',
    methods: ['get'],
  },
  {
    openapiPath: '/api/v1/host-status',
    tanstackPath: '/api/v1/host-status',
    methods: ['get'],
  },
  {
    openapiPath: '/api/v1/overview',
    tanstackPath: '/api/v1/overview',
    methods: ['get'],
  },
  {
    openapiPath: '/api/v1/charts/{name}',
    tanstackPath: '/api/v1/charts/$name',
    methods: ['get'],
  },
  {
    openapiPath: '/api/v1/tables',
    tanstackPath: '/api/v1/tables/',
    methods: ['get'],
  },
  {
    openapiPath: '/api/v1/tables/{name}',
    tanstackPath: '/api/v1/tables/$name',
    methods: ['get'],
  },
  {
    openapiPath: '/api/v1/findings',
    tanstackPath: '/api/v1/findings',
    methods: ['get'],
  },
  {
    openapiPath: '/api/v1/agent',
    tanstackPath: '/api/v1/agent',
    methods: ['post'],
  },
  {
    openapiPath: '/api/mcp',
    tanstackPath: '/api/mcp',
    methods: ['get', 'post', 'delete', 'options'],
  },
  {
    openapiPath: '/api/v1/auth/api-key',
    tanstackPath: '/api/v1/auth/api-key',
    methods: ['post'],
  },
  {
    openapiPath: '/api/v1/auth/cli',
    tanstackPath: '/api/v1/auth/cli',
    methods: ['get'],
  },
  {
    openapiPath: '/api/v1/auth/device/code',
    tanstackPath: '/api/v1/auth/device/code',
    methods: ['post'],
  },
  {
    openapiPath: '/api/v1/auth/token',
    tanstackPath: '/api/v1/auth/token',
    methods: ['post'],
  },
] as const satisfies readonly PublicApiRoute[]

/** Hard floor so GET /api/v1/openapi.json cannot silently become a 2-path stub. */
export const MIN_PUBLIC_API_PATHS = 10

/** Paths every published spec must include (subset of PUBLIC_API_ROUTES). */
export const REQUIRED_PUBLIC_API_PATHS = [
  '/api/health',
  '/api/v1/openapi.json',
  '/api/v1/hosts',
  '/api/v1/charts/{name}',
  '/api/v1/tables/{name}',
  '/api/v1/host-status',
  '/api/v1/overview',
] as const

export function listPublicOpenApiPaths(): string[] {
  return PUBLIC_API_ROUTES.map((route) => route.openapiPath)
}

export function listPublicTanstackPaths(): string[] {
  return PUBLIC_API_ROUTES.map((route) => route.tanstackPath)
}
