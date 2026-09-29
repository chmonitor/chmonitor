/**
 * Read-only marker for an alert definition that comes from a declarative
 * source (#3497): `file` = the mounted `CHM_HEALTH_CONFIG_DIRECTORY`
 * (ConfigMap), `env` = a `HEALTH_*` env var. Such rows cannot be deleted from
 * the UI — the operator removes them from their source — so rows render this
 * badge in place of the Delete control.
 */

import type { HealthDefinitionSource } from '@/lib/health/declarative/merge'

import { Badge } from '@/components/ui/badge'

/** True for a row the UI must not offer to delete. */
export function isDeclarativeSource(
  source: HealthDefinitionSource | undefined
): source is 'file' | 'env' {
  return source === 'file' || source === 'env'
}

export function DeclarativeSourceBadge({ source }: { source: 'file' | 'env' }) {
  return (
    <Badge
      variant="outline"
      className="shrink-0"
      title={
        source === 'file'
          ? 'Defined in the health config directory — read-only here'
          : 'Defined by a server environment variable — read-only here'
      }
    >
      {source === 'file' ? 'Config file' : 'Env'}
    </Badge>
  )
}
