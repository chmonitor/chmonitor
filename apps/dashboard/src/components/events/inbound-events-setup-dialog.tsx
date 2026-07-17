/**
 * Inbound Events — Setup dialog.
 *
 * Self-contained integration help for the Inbound Events page: the host-aware
 * ingest endpoint URL, the auth header, every payload shape the ingest parser
 * accepts (Alertmanager / Datadog / generic, single or batched, JSON body or
 * query params), and copy-paste curl + JS examples. Also states the storage
 * contract explicitly — events land in Cloudflare D1 on the hosted app and are
 * normalized/re-emitted (not persisted) on self-host; they are NOT written to
 * ClickHouse. See lib/events/ and docs/content/guide/features/inbound-events.mdx.
 */

import { Check, Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { describeError } from '@/lib/swr/fetch-error'
import { cn } from '@/lib/utils'

const DOCS_URL = 'https://docs.chmonitor.dev/guide/features/inbound-events'

/** The public ingest endpoint, resolved from the browser's current origin so
 *  the copy matches wherever this instance is served (hosted or self-host). */
function useIngestEndpoint(): string {
  if (typeof window === 'undefined') return '/api/events/ingest'
  return `${window.location.origin}/api/events/ingest`
}

/** A labelled, copy-to-clipboard code block. */
function CopyBlock({
  code,
  label,
  className,
}: {
  code: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success(label ? `${label} copied` : 'Copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      toast.error('Failed to copy', { description: describeError(err) })
    }
  }

  return (
    <div className={cn('relative', className)}>
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 pr-11 font-mono text-xs leading-relaxed">
        {code}
      </pre>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label ? `Copy ${label}` : 'Copy'}
        className="absolute top-2 right-2"
        onClick={handleCopy}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}

export function InboundEventsSetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const endpoint = useIngestEndpoint()

  const curlExample = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer $CHM_EVENTS_INGEST_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Disk usage high",
    "severity": "critical",
    "resource": "ch-node-1",
    "body": "Free space on /var/lib/clickhouse is below 10%"
  }'`

  const jsExample = `await fetch(${JSON.stringify(endpoint)}, {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.CHM_EVENTS_INGEST_TOKEN}\`,
    "Content-Type": "application/json",
  },
  // A single object, or an array to send a batch in one request.
  body: JSON.stringify({
    title: "Disk usage high",
    severity: "critical",
    resource: "ch-node-1",
  }),
})`

  const batchExample = `[
  { "title": "Replica lagging", "severity": "warning", "resource": "ch-2" },
  { "title": "Merge backlog",   "severity": "info",    "resource": "ch-2" }
]`

  const queryExample = `curl -X POST "${endpoint}?title=Backup+failed&severity=critical&resource=ch-node-1" \\
  -H "Authorization: Bearer $CHM_EVENTS_INGEST_TOKEN"`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Set up inbound events</DialogTitle>
          <DialogDescription>
            Forward Alertmanager, Datadog, or any generic webhook to chmonitor.
            Events are normalized, de-duplicated, and shown on this page.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 text-sm">
          {/* Endpoint + auth */}
          <section className="flex flex-col gap-2">
            <h3 className="font-medium">Endpoint</h3>
            <CopyBlock code={`POST ${endpoint}`} label="Endpoint URL" />
            <p className="text-xs text-muted-foreground">
              Authenticate with a bearer token that matches the{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                CHM_EVENTS_INGEST_TOKEN
              </code>{' '}
              secret set on the server. The endpoint is disabled (503) until
              that secret is configured.
            </p>
          </section>

          {/* Formats */}
          <section className="flex flex-col gap-2">
            <h3 className="font-medium">Supported payloads</h3>
            <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              <li>
                <Badge variant="outline" className="mr-2">
                  Alertmanager
                </Badge>
                Standard webhook body (<code>alerts[]</code> +{' '}
                <code>commonLabels</code>) — detected automatically.
              </li>
              <li>
                <Badge variant="outline" className="mr-2">
                  Datadog
                </Badge>
                Monitor webhook body (<code>alert_type</code> +{' '}
                <code>aggreg_key</code>) — detected automatically.
              </li>
              <li>
                <Badge variant="outline" className="mr-2">
                  Generic
                </Badge>
                Any JSON object. Common field aliases are accepted:{' '}
                <code>title/name/summary</code>,{' '}
                <code>resource/host/service</code>,{' '}
                <code>severity/level/priority</code>,{' '}
                <code>body/message/text</code>.
              </li>
              <li>
                <Badge variant="outline" className="mr-2">
                  Batch
                </Badge>
                Send a JSON array (or <code>{'{ events: [...] }'}</code>) to
                ingest many events in one request.
              </li>
              <li>
                <Badge variant="outline" className="mr-2">
                  Query params
                </Badge>
                No JSON? Pass fields as query params:{' '}
                <code>?title=…&amp;severity=…&amp;resource=…</code>.
              </li>
            </ul>
          </section>

          {/* Examples */}
          <section className="flex flex-col gap-2">
            <h3 className="font-medium">Examples</h3>
            <Tabs defaultValue="curl">
              <TabsList>
                <TabsTrigger value="curl">curl</TabsTrigger>
                <TabsTrigger value="js">JavaScript</TabsTrigger>
                <TabsTrigger value="batch">Batch</TabsTrigger>
                <TabsTrigger value="query">Query params</TabsTrigger>
              </TabsList>
              <TabsContent value="curl" className="mt-2">
                <CopyBlock code={curlExample} label="curl example" />
              </TabsContent>
              <TabsContent value="js" className="mt-2">
                <CopyBlock code={jsExample} label="JavaScript example" />
              </TabsContent>
              <TabsContent value="batch" className="mt-2">
                <CopyBlock code={batchExample} label="Batch example" />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  POST this array as the request body to the same endpoint.
                </p>
              </TabsContent>
              <TabsContent value="query" className="mt-2">
                <CopyBlock code={queryExample} label="Query-param example" />
              </TabsContent>
            </Tabs>
          </section>

          {/* Storage contract */}
          <Alert>
            <AlertTitle>Where do events go?</AlertTitle>
            <AlertDescription className="text-xs">
              On the hosted app, events are stored in Cloudflare D1 and retained
              ~30 days. On a self-hosted instance without D1, each event is
              still normalized and (if configured) re-emitted to your outbound
              alert routes, but not persisted. Inbound events are{' '}
              <strong>not written to ClickHouse</strong> — they are chmonitor's
              own alert feed, separate from your monitored cluster.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <Button
            variant="link"
            className="h-auto p-0 text-xs"
            render={
              <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                Read the docs
                <ExternalLink className="ml-1 size-3" />
              </a>
            }
          />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
