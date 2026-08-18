/**
 * GET /api/v1/openapi.json
 *
 * Public discovery document (RFC 9727 service-desc). Auth is exempted in
 * api-guard so anonymous callers always get 200, never 401/500.
 */

import { createFileRoute } from '@tanstack/react-router'

import { openApiResponse } from '@/lib/api/openapi-spec'

export const Route = createFileRoute('/api/v1/openapi.json')({
  server: {
    handlers: {
      GET: () => openApiResponse(),
    },
  },
})
