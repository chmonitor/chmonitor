import { BookOpenIcon, ExternalLinkIcon, PlugZapIcon } from 'lucide-react'

import { docsSiteUrl } from '@/lib/docs-site'

/** Shown when PEERDB_API_URL is unset and the proxy returns 503. */
export function PeerDBNotConfigured() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-lg border border-dashed p-10 text-center">
      <PlugZapIcon className="size-8 text-muted-foreground" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">PeerDB is not configured</h2>
        <p className="text-sm text-muted-foreground">
          Point CHM at your PeerDB deployment to monitor mirrors and peers.
          Monitoring is view-only — CHM never mutates PeerDB.
        </p>
      </div>

      <ol className="w-full space-y-2 text-left text-sm text-muted-foreground">
        <li>
          1. Set <code className="rounded bg-muted px-1">PEERDB_API_URL</code>{' '}
          to your PeerDB REST API (the PeerDB UI URL with an{' '}
          <code className="rounded bg-muted px-1">/api</code> suffix, or a raw
          flow-api origin).
        </li>
        <li>
          2. Set <code className="rounded bg-muted px-1">PEERDB_PASSWORD</code>{' '}
          if the API requires auth (leave empty otherwise).
        </li>
        <li>3. Restart the app.</li>
      </ol>

      <pre className="w-full overflow-x-auto rounded-md bg-muted px-3 py-2 text-left font-mono text-xs">
        {`PEERDB_API_URL=https://peerdb.example.com/api
PEERDB_PASSWORD=your-peerdb-ui-password`}
      </pre>

      <p className="text-xs text-muted-foreground">
        Or attach PeerDB per connection: open a connection&apos;s{' '}
        <span className="font-medium text-foreground">Advanced</span> section,
        add its PeerDB API URL (Password or API token auth), then view it at{' '}
        <code className="rounded bg-muted px-1">
          /peerdb?connection=&lt;id&gt;
        </code>
        .
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <a
          href={docsSiteUrl('advanced/peerdb-monitoring')}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-[13px] font-medium text-background hover:bg-foreground/90"
        >
          <BookOpenIcon className="size-3.5" />
          Setup guide
        </a>
        <a
          href={docsSiteUrl('reference/environment-variables')}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-muted"
        >
          Environment variables
        </a>
        <a
          href="https://docs.peerdb.io"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-muted"
        >
          <ExternalLinkIcon className="size-3.5" />
          PeerDB docs
        </a>
      </div>
    </div>
  )
}
