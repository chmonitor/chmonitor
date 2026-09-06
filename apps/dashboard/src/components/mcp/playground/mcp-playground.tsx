import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Timer,
} from 'lucide-react'

import { CodeBlock, CopyButton } from '../copy-button'
import { describeError } from './error-copy'
import { FieldInput } from './field-input'
import { staticToolDescriptors } from './tool-descriptors'
import { MCP_TOOLS } from '@chm/mcp-server/data'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  buildJsonRpcRequest,
  buildSchemaFormForTool,
  callTool,
  coerceFormValues,
  listTools,
  type McpCallResult,
  type McpErrorKind,
  type McpExchange,
  McpRequestError,
  type McpToolDescriptor,
  parseRawArguments,
  resultText,
  validateFormValues,
} from '@/lib/mcp'

/**
 * A real MCP client for our own `/api/mcp` endpoint.
 *
 * Tools are DISCOVERED from the live server (`tools/list`) rather than read
 * from the static catalog, so the Playground always reflects what the endpoint
 * actually serves. The static `MCP_TOOLS` catalog is the fallback when
 * discovery is blocked (unauthenticated / plan-gated), which keeps the tab
 * useful in every auth posture instead of showing an empty page.
 */

export function McpPlayground() {
  const [endpoint, setEndpoint] = useState('/api/mcp')
  const [apiKey, setApiKey] = useState('')
  const [tools, setTools] = useState<McpToolDescriptor[]>(staticToolDescriptors)
  const [discovered, setDiscovered] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [selected, setSelected] = useState(MCP_TOOLS[0]?.name ?? '')
  const [values, setValues] = useState<Record<string, string>>({})
  const [rawMode, setRawMode] = useState(false)
  const [rawArgs, setRawArgs] = useState('{}')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<McpCallResult | null>(null)
  const [exchange, setExchange] = useState<McpExchange | null>(null)
  const [error, setError] = useState<{
    kind: McpErrorKind
    message: string
  } | null>(null)

  useEffect(() => {
    setEndpoint(`${window.location.origin}/api/mcp`)
  }, [])

  const tool = tools.find((t) => t.name === selected) ?? tools[0]
  const form = useMemo(
    () =>
      tool
        ? buildSchemaFormForTool(tool)
        : { fields: [], requiresRawJson: false },
    [tool]
  )
  // A schema we cannot fully render forces the raw editor — never send a
  // silently incomplete argument set.
  const useRaw = rawMode || form.requiresRawJson

  const discover = useCallback(async () => {
    setDiscovering(true)
    try {
      const { tools: live } = await listTools({
        endpoint,
        apiKey: apiKey || undefined,
      })
      if (live.length > 0) {
        setTools(live)
        setDiscovered(true)
        setError(null)
        if (!live.some((t) => t.name === selected)) {
          setSelected(live[0].name)
        }
      }
    } catch (err) {
      setDiscovered(false)
      if (err instanceof McpRequestError) {
        setError({ kind: err.kind, message: err.message })
      }
    } finally {
      setDiscovering(false)
    }
  }, [endpoint, apiKey, selected])

  // Discover once, as soon as the real endpoint origin is known. Deliberately
  // keyed on the endpoint alone: re-running whenever `discover` changes identity
  // (it closes over the selected tool, which discovery itself may change) would
  // loop. Adding a key re-discovers via the explicit Connect/Refresh buttons.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (endpoint.startsWith('http')) void discover()
  }, [endpoint])

  const args = useRaw
    ? parseRawArguments(rawArgs)
    : ({ ok: true, args: coerceFormValues(form.fields, values) } as const)
  const validationErrors = useRaw
    ? args.ok
      ? []
      : [args.error]
    : validateFormValues(form.fields, values)

  const previewRequest = buildJsonRpcRequest('tools/call', {
    name: tool?.name,
    arguments: args.ok ? args.args : {},
  })

  const curl = `curl -X POST ${endpoint} \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "MCP-Protocol-Version: 2026-07-28" \\
  -H "Mcp-Method: tools/call" \\
  -H "Mcp-Name: ${tool?.name ?? ''}" \\
  -d '${JSON.stringify(previewRequest).replace(/'/g, "'\\''")}'`

  const run = async () => {
    if (!tool || !args.ok || validationErrors.length > 0) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const response = await callTool(tool.name, args.args, {
        endpoint,
        apiKey: apiKey || undefined,
      })
      setResult(response.result)
      setExchange(response.exchange)
    } catch (err) {
      if (err instanceof McpRequestError) {
        setError({ kind: err.kind, message: err.message })
      } else {
        setError({
          kind: 'network',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    } finally {
      setRunning(false)
    }
  }

  const errorInfo = error ? describeError(error.kind) : null
  const text = result ? resultText(result) : ''

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base">Playground</CardTitle>
            <CardDescription className="text-xs">
              Call this deployment&apos;s MCP tools straight from the browser
              over Streamable HTTP.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="gap-1 px-1.5 py-0 text-[10px] font-normal"
            >
              {discovered ? (
                <CheckCircle2 className="size-3 text-emerald-500" />
              ) : (
                <Braces className="size-3" />
              )}
              {discovered ? 'Live tools' : 'Static catalog'}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void discover()}
              disabled={discovering}
            >
              {discovering ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {errorInfo && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-500" />
              <p className="text-sm font-medium">{errorInfo.title}</p>
            </div>
            <p className="text-xs text-muted-foreground">{errorInfo.hint}</p>
            {errorInfo.needsKey && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <KeyRound className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="API key (sent as x-api-key)"
                    className="h-8 pl-7 font-mono text-xs"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => void discover()}
                >
                  Connect
                </Button>
              </div>
            )}
            {error && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Server response</summary>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">
                  {error.message}
                </pre>
              </details>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Tool</Label>
          <Select
            value={tool?.name ?? ''}
            onValueChange={(name) => {
              if (name == null) return
              setSelected(name)
              setValues({})
              setRawArgs('{}')
              setResult(null)
              setExchange(null)
            }}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tools.map((t) => (
                <SelectItem key={t.name} value={t.name} className="text-xs">
                  <code>{t.name}</code>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-foreground">{tool?.description}</p>
            {tool?.annotations?.readOnlyHint && (
              <Badge
                variant="outline"
                className="gap-1 px-1.5 py-0 text-[10px] font-normal"
              >
                <ShieldCheck className="size-3" />
                read-only
              </Badge>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Arguments
            </h5>
            {!form.requiresRawJson && form.fields.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setRawMode(!rawMode)}
              >
                <Braces className="size-3.5" />
                {rawMode ? 'Use form' : 'Edit as JSON'}
              </Button>
            )}
          </div>

          {useRaw ? (
            <div className="space-y-1.5">
              {form.requiresRawJson && (
                <p className="text-xs text-muted-foreground">
                  This tool takes a nested argument, so edit the arguments
                  object directly.
                </p>
              )}
              <Textarea
                value={rawArgs}
                onChange={(e) => setRawArgs(e.target.value)}
                rows={5}
                spellCheck={false}
                className="font-mono text-xs"
              />
            </div>
          ) : form.fields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This tool takes no arguments.
            </p>
          ) : (
            form.fields.map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                value={values[field.name] ?? ''}
                onChange={(value) =>
                  setValues((prev) => ({ ...prev, [field.name]: value }))
                }
              />
            ))
          )}

          {validationErrors.length > 0 && (
            <p className="text-xs text-destructive">
              {validationErrors.join(' · ')}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => void run()}
            disabled={running || validationErrors.length > 0}
          >
            {running ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            {running ? 'Running…' : 'Run tool'}
          </Button>
          <CopyButton text={curl} label="Copy curl" className="h-8 text-xs" />
          {exchange && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Timer className="size-3.5" />
              {exchange.durationMs} ms · HTTP {exchange.status}
            </span>
          )}
        </div>

        {result && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Result
                </h5>
                {result.isError ? (
                  <Badge
                    variant="outline"
                    className="border-destructive/40 px-1.5 py-0 text-[10px] text-destructive"
                  >
                    tool error
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="px-1.5 py-0 text-[10px] font-normal"
                  >
                    ok
                  </Badge>
                )}
              </div>

              {text && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Text content</p>
                  <CodeBlock>{text}</CodeBlock>
                </div>
              )}

              {result.structuredContent !== undefined && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    Structured content
                  </p>
                  <CodeBlock>
                    {JSON.stringify(result.structuredContent, null, 2)}
                  </CodeBlock>
                </div>
              )}
            </div>
          </>
        )}

        {exchange && (
          <>
            <Separator />
            <details className="space-y-2">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Request / response inspector
              </summary>
              <div className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Request headers
                    </p>
                  </div>
                  <CodeBlock>
                    {JSON.stringify(exchange.headers, null, 2)}
                  </CodeBlock>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    JSON-RPC request
                  </p>
                  <CodeBlock>
                    {JSON.stringify(exchange.request, null, 2)}
                  </CodeBlock>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    JSON-RPC response
                  </p>
                  <CodeBlock>
                    {JSON.stringify(exchange.response, null, 2)}
                  </CodeBlock>
                </div>
              </div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  )
}
