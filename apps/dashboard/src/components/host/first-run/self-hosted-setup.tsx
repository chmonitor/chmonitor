import { FlaskConical, Terminal } from 'lucide-react'

import { DocsFooter } from './docs-footer'
import { EngineChooser, type OpenAddHostOptions } from './engine-chooser'
import { WelcomeHeader } from './welcome-header'
import { Button } from '@/components/ui/button'
import { isFeatureEnabled } from '@/lib/feature-flags'

export function SelfHostedSetup({
  onAddHost,
}: {
  onAddHost: (opts?: OpenAddHostOptions) => void
}) {
  const allowPostgres = isFeatureEnabled('postgresSource')
  return (
    <div className="space-y-7">
      <WelcomeHeader
        title={
          allowPostgres
            ? 'Connect a database to get started'
            : 'Connect a ClickHouse host to get started'
        }
        subtitle={
          allowPostgres
            ? 'No sources are configured yet. Set ClickHouse hosts once via environment variables, or connect a ClickHouse or Postgres source from your browser.'
            : 'No ClickHouse hosts are configured yet. Set them once via environment variables, or add one from your browser.'
        }
      />

      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Terminal className="size-4 text-muted-foreground" />
          Environment variables
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Set these and restart the app (comma-separated for multiple hosts):
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-[12px] leading-relaxed">
          <code>{`CLICKHOUSE_HOST=https://host:8443
CLICKHOUSE_USER=monitoring
CLICKHOUSE_PASSWORD=••••••••`}</code>
        </pre>

        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <EngineChooser
          onAddHost={onAddHost}
          allowPostgres={allowPostgres}
          clickhouseLabel="Connect ClickHouse"
        />

        <Button
          className="mt-2 w-full"
          variant="outline"
          onClick={() => onAddHost({ preset: 'sample' })}
          data-testid="welcome-try-sample"
        >
          <FlaskConical className="size-4" />
          Try with sample ClickHouse
        </Button>
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          A public, read-only demo — explore schema &amp; SQL, no setup
          required.
        </p>
      </div>

      <DocsFooter
        links={[
          { slug: 'getting-started', label: 'Getting started' },
          {
            slug: 'reference/environment-variables',
            label: 'Environment variables',
          },
          {
            slug: 'guides/connection-errors',
            label: 'Connection troubleshooting',
          },
        ]}
      />
    </div>
  )
}
