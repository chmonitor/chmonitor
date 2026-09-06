import { DatabaseZap, FlaskConical, PlugZap, ShieldCheck } from 'lucide-react'

import { DocsFooter } from './docs-footer'
import { EngineChooser, type OpenAddHostOptions } from './engine-chooser'
import { SetupStep } from './setup-step'
import { WelcomeHeader } from './welcome-header'
import { Button } from '@/components/ui/button'
import { docsSiteUrl } from '@/lib/docs-site'
import { isFeatureEnabled } from '@/lib/feature-flags'

export function ConnectYourHost({
  onAddHost,
}: {
  onAddHost: (opts?: OpenAddHostOptions) => void
}) {
  const allowPostgres = isFeatureEnabled('postgresSource')

  return (
    <div className="space-y-7">
      <WelcomeHeader
        title={
          allowPostgres ? 'Connect your database' : 'Connect your ClickHouse'
        }
        subtitle={
          allowPostgres
            ? 'Your workspace is ready. Connect a ClickHouse or Postgres source to start monitoring queries, performance and health.'
            : 'Your workspace is ready. Add a ClickHouse host to start monitoring queries, merges, replication and cluster health.'
        }
      />

      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <ul className="space-y-4">
          <SetupStep
            icon={<DatabaseZap className="size-4" />}
            title="1. Have your connection details"
          >
            {allowPostgres ? (
              <>
                The endpoint or host (e.g.{' '}
                <code className="rounded bg-muted px-1 text-[11px]">
                  https://host:8443
                </code>{' '}
                for ClickHouse,{' '}
                <code className="rounded bg-muted px-1 text-[11px]">
                  host:5432
                </code>{' '}
                for Postgres), username and password.
              </>
            ) : (
              <>
                The HTTP(S) endpoint (e.g.{' '}
                <code className="rounded bg-muted px-1 text-[11px]">
                  https://host:8443
                </code>
                ), username and password.
              </>
            )}
          </SetupStep>
          <SetupStep
            icon={<ShieldCheck className="size-4" />}
            title="2. Use a read-only monitoring user"
          >
            A user with{' '}
            <code className="rounded bg-muted px-1 text-[11px]">SELECT</code> on{' '}
            <code className="rounded bg-muted px-1 text-[11px]">system.*</code>{' '}
            is enough. No write access needed.
          </SetupStep>
          <SetupStep
            icon={<PlugZap className="size-4" />}
            title="3. Connect and explore"
          >
            Credentials are stored encrypted and synced to your account. Test
            the connection before saving.
          </SetupStep>
        </ul>

        <EngineChooser
          className="mt-5"
          onAddHost={onAddHost}
          allowPostgres={allowPostgres}
          clickhouseLabel="Connect ClickHouse"
        />

        <Button
          className="mt-2 w-full"
          size="lg"
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

        <p className="text-muted-foreground mt-3 text-center text-xs">
          Not sure where to start?{' '}
          <a
            href={docsSiteUrl('getting-started/clickhouse-requirements')}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Read the full setup guide
          </a>
        </p>
      </div>

      <p className="text-muted-foreground text-center text-xs">
        Already run ClickHouse yourself?{' '}
        <a
          href="https://chmonitor.dev/pricing/"
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          Self-host license
        </a>
        {' · '}
        <a
          href="https://docs.chmonitor.dev/operate/advanced/commercial-license"
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          How licenses work
        </a>
      </p>

      <DocsFooter
        links={[
          { slug: 'getting-started', label: 'Getting started' },
          {
            slug: 'getting-started/clickhouse-requirements',
            label: 'Create a monitoring user',
          },
          {
            slug: 'guides/connect-firewalled-clickhouse',
            label: 'Connect behind a firewall',
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
