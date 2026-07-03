// Pure, testable helpers for the OTel trace-export integration (opt-in, OFF by
// default). Mirrors the split used by the Sentry integration
// (src/lib/observability/sentry-options.ts): pure option resolution here, the
// stateful SDK singleton in ./exporter.ts.

import type { Attributes } from '@opentelemetry/api'

import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'

/**
 * Validate `CHM_OTEL_EXPORTER_URL`: must be an absolute http(s) URL pointing
 * at an operator-set collector (Jaeger/Tempo/etc — trusted, like a logging
 * sink). Returns `undefined` for unset, blank, or invalid values, which every
 * caller treats as "trace export disabled" (fail-open). This is validated
 * once at startup from the operator's own env config — never derive it from
 * request data.
 */
export function parseOtelExporterUrl(
  raw: string | undefined
): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return undefined
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined
  }

  return trimmed
}

/** Resource attributes describing this chmonitor instance to the collector. */
export function buildOtelResourceAttributes(input: {
  version: string | undefined
  edition: string
}): Attributes {
  const attributes: Attributes = {
    [ATTR_SERVICE_NAME]: 'chmonitor',
    'chmonitor.edition': input.edition,
  }
  if (input.version) {
    attributes[ATTR_SERVICE_VERSION] = input.version
  }
  return attributes
}
