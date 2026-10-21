import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'

// App version (the CH version() query is deferred to a CH-querying route).
// Overridable via env.
const APP_VERSION = '0.2.0'

export const Route = createFileRoute('/api/version')({
  server: {
    handlers: {
      GET: () => {
        const bindings = env as Record<string, string | undefined>
        return Response.json({ ui: bindings.APP_VERSION ?? APP_VERSION })
      },
    },
  },
})
