import { PlugZap, Server } from 'lucide-react'

import type { ConnectionPreset } from '@/components/connections/connection-presets'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Options for opening the Add-host dialog from a first-run CTA. */
export type OpenAddHostOptions = {
  /** Prefill the read-only sample ClickHouse preset. */
  preset?: 'sample'
  /** Connection-type tab to open on (e.g. `'postgres'`). */
  engine?: ConnectionPreset
}

export function EngineChooser({
  onAddHost,
  allowPostgres,
  clickhouseLabel,
  className,
}: {
  onAddHost: (opts?: OpenAddHostOptions) => void
  allowPostgres: boolean
  clickhouseLabel: string
  className?: string
}) {
  return (
    <div
      className={cn('grid gap-2', allowPostgres && 'sm:grid-cols-2', className)}
    >
      <Button
        size="lg"
        onClick={() => onAddHost({ engine: 'self-hosted' })}
        data-testid="welcome-add-host"
      >
        <PlugZap className="size-4" />
        {clickhouseLabel}
      </Button>
      {allowPostgres && (
        <Button
          size="lg"
          variant="outline"
          onClick={() => onAddHost({ engine: 'postgres' })}
          data-testid="welcome-add-postgres"
        >
          <Server className="size-4" />
          Connect Postgres
          <Badge
            variant="secondary"
            className="ml-1 px-1.5 py-0 text-[10px] font-medium"
          >
            Beta
          </Badge>
        </Button>
      )}
    </div>
  )
}
