import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { getClient } from '@chm/clickhouse-client'
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { bridgeApiKeyEnv, enforceAuth } from '@/lib/auth/api-guard'

export const Route = createFileRoute('/api/timezone')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)
        bridgeApiKeyEnv(env as Record<string, string | undefined>)

        // Sits outside the /api/v1/* middleware guard, so enforce auth here —
        // same pattern as /api/pageview. Anonymous is still allowed when the
        // auth provider is `none` (self-hosted default).
        const authFailure = await enforceAuth(request)
        if (authFailure) return authFailure

        const configs = getClickHouseConfigsFromEnv(
          env as Record<string, string | undefined>
        )

        if (configs.length === 0) {
          return Response.json(
            { error: 'No ClickHouse host configured' },
            { status: 500 }
          )
        }

        try {
          const client = await getClient({
            web: true,
            clientConfig: configs[0],
          })
          const resultSet = await client.query({
            query: 'SELECT timezone() AS tz',
            format: 'JSON',
          })
          // JSON format wraps rows: json<Row>() => { data: Row[], ... }
          const json = await resultSet.json<{ tz: string }>()
          const tz = json.data[0]?.tz

          if (!tz) {
            return Response.json(
              { error: 'Timezone query returned no result' },
              { status: 500 }
            )
          }

          return Response.json({ tz })
        } catch {
          return Response.json(
            { error: 'Failed to query timezone' },
            { status: 500 }
          )
        }
      },
    },
  },
})
