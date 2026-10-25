import { ArrowUpRight } from 'lucide-react'

import { BrokenWireIllustration } from '@/components/illustrations/broken-wire-illustration'
import { classifyConnectionError } from '@/lib/connection-errors'
import { docsSiteUrl } from '@/lib/docs-site'

export function ConnectionErrorPanel({
  message,
  cloudPreset = false,
}: {
  message?: string
  cloudPreset?: boolean
}) {
  const e = classifyConnectionError(message)
  // Cloud preset reachability failures are almost always a TLS/port mismatch
  // (8443 HTTPS, never plain HTTP).
  const showCloudTlsHint =
    cloudPreset &&
    (e.kind === 'tls_error' ||
      e.kind === 'connection_refused' ||
      e.kind === 'invalid_url' ||
      e.kind === 'timeout')
  return (
    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <div className="flex justify-center pb-1">
        <BrokenWireIllustration kind={e.kind} />
      </div>
      <p className="text-sm font-medium text-destructive">{e.title}</p>
      <p className="text-xs text-muted-foreground">{e.explanation}</p>
      <p className="text-xs">
        <span className="font-medium">What to do: </span>
        <span className="text-muted-foreground">{e.fix}</span>
      </p>
      {showCloudTlsHint && (
        <p className="text-xs">
          <span className="font-medium">ClickHouse Cloud: </span>
          <span className="text-muted-foreground">
            requires TLS on port 8443 — confirm the URL starts with{' '}
            <code className="text-foreground">https://</code> and ends with{' '}
            <code className="text-foreground">:8443</code>.
          </span>
        </p>
      )}
      {e.raw && (
        <pre className="overflow-x-auto rounded bg-muted/60 p-2 text-[11px] max-sm:text-xs text-muted-foreground">
          <code>{e.raw}</code>
        </pre>
      )}
      <a
        href={docsSiteUrl(e.docsSlug)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
      >
        View troubleshooting docs
        <ArrowUpRight className="size-3" />
      </a>
    </div>
  )
}
