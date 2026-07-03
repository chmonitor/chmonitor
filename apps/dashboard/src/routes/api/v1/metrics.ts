/**
 * Prometheus metrics exporter endpoint.
 * GET /api/v1/metrics
 *
 * Serves `system.metrics` + `system.asynchronous_metrics` for every
 * configured ClickHouse host, plus chmonitor's own alert-firing gauge, as
 * Prometheus text exposition format. Cached ~30s (see prometheus-exporter.ts).
 *
 * Feature-gated by CHM_FEATURE_PROMETHEUS_ENABLED: on by default self-hosted,
 * off by default in cloud mode. Disabled -> 404 (not 403) so cloud never
 * advertises the surface. No `/metrics` alias: that path is already the
 * dashboard's system.metrics browsing page (routes/(dashboard)/metrics.tsx).
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config'
import {
  getPrometheusMetricsText,
  isPrometheusExporterEnabled,
} from '@/lib/metrics/prometheus-exporter'

export const Route = createFileRoute('/api/v1/metrics')({
  server: {
    handlers: {
      GET: async () => {
        const bindings = env as Record<string, string | undefined>

        // Fail-open, no billing/plan gate: purely cloud-mode derived.
        if (!isPrometheusExporterEnabled(bindings)) {
          return new Response('Not Found', {
            status: 404,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }

        const configs = getClickHouseConfigsFromEnv(bindings)
        const body = await getPrometheusMetricsText(configs)

        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        })
      },
    },
  },
})
