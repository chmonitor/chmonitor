'use client'

/**
 * MCP Server Manager — per-user registry of external Model Context Protocol
 * servers (plan 43). Backed by D1 through `/api/v1/mcp/servers`; each server is
 * validated (SSRF-guarded) on save and loaded alongside the agent's built-in
 * tools at conversation start.
 *
 * Distinct from the welcome-screen `AgentMcpPanel` (localStorage quick-config):
 * this surface PERSISTS per-user, server-side, with auth + a template library.
 */

import {
  CheckCircle2Icon,
  Loader2Icon,
  PlugZapIcon,
  PlusIcon,
  ServerIcon,
  Trash2Icon,
  XCircleIcon,
} from 'lucide-react'

import type {
  McpAuthKind,
  McpRegistrationDto,
  McpTransport,
  TestMcpConnectionResult,
} from '@/lib/swr/use-mcp-registry'

import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  type CreateMcpServerInput,
  McpRegistryRequestError,
  testMcpConnection,
  useCreateMcpServer,
  useDeleteMcpServer,
  useMcpRegistryServers,
  usePatchMcpServer,
} from '@/lib/swr/use-mcp-registry'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Template library — starter presets. The Test button is the source of truth;
// confirm the exact endpoint/region for your account before saving.
// ---------------------------------------------------------------------------

interface ServerTemplate {
  id: string
  label: string
  url: string
  transport: McpTransport
  authKind: McpAuthKind
  authHeaderName?: string
  hint: string
}

const TEMPLATES: ServerTemplate[] = [
  {
    id: 'github',
    label: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    transport: 'http',
    authKind: 'bearer',
    hint: 'Use a GitHub personal access token as the bearer token.',
  },
  {
    id: 'slack',
    label: 'Slack',
    url: 'https://mcp.slack.com/mcp',
    transport: 'http',
    authKind: 'bearer',
    hint: 'Provide your Slack MCP bearer token (verify your workspace URL).',
  },
  {
    id: 'datadog',
    label: 'Datadog',
    url: 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp',
    transport: 'http',
    authKind: 'header',
    authHeaderName: 'DD-API-KEY',
    hint: 'Send your Datadog API key in the DD-API-KEY header.',
  },
]

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function TransportBadge({ transport }: { transport: McpTransport }) {
  return (
    <Badge variant="outline" className="h-5 px-1.5 text-[10px] uppercase">
      {transport}
    </Badge>
  )
}

function AuthBadge({
  authKind,
  headerName,
}: {
  authKind: McpAuthKind
  headerName: string | null
}) {
  if (authKind === 'none') {
    return <span className="text-muted-foreground text-[11px]">No auth</span>
  }
  return (
    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
      {authKind === 'bearer' ? 'Bearer' : `Header: ${headerName ?? '—'}`}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Server row
// ---------------------------------------------------------------------------

function ServerRow({ server }: { server: McpRegistrationDto }) {
  const patch = usePatchMcpServer()
  const remove = useDeleteMcpServer()

  const toolCount = server.capabilities?.length ?? 0
  const validated = server.lastValidatedAt
    ? new Date(server.lastValidatedAt).toLocaleDateString()
    : null

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md">
        <ServerIcon className="text-foreground size-4" strokeWidth={1.5} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium">
            {server.name}
          </span>
          <TransportBadge transport={server.transport} />
          <AuthBadge
            authKind={server.authKind}
            headerName={server.authHeaderName}
          />
        </div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px]">
          <span className="truncate">{server.url}</span>
        </div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[10.5px] tabular-nums">
          <span>{toolCount} tools</span>
          {validated && (
            <>
              <span className="text-border">·</span>
              <span>validated {validated}</span>
            </>
          )}
          {!server.enabled && (
            <>
              <span className="text-border">·</span>
              <span>disabled</span>
            </>
          )}
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive size-8 shrink-0"
        disabled={remove.isPending}
        onClick={() => remove.mutate(server.id)}
        aria-label={`Remove ${server.name}`}
      >
        {remove.isPending ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <Trash2Icon className="size-4" />
        )}
      </Button>

      <Switch
        checked={server.enabled}
        disabled={patch.isPending}
        onCheckedChange={(next) =>
          patch.mutate({ id: server.id, enabled: next })
        }
        aria-label={
          server.enabled ? `Disable ${server.name}` : `Enable ${server.name}`
        }
        className="shrink-0"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add server form (name / url / transport / auth) with a Test button
// ---------------------------------------------------------------------------

const EMPTY_FORM: CreateMcpServerInput = {
  name: '',
  url: '',
  transport: 'http',
  authKind: 'none',
  authSecret: '',
  authHeaderName: '',
}

function AddServerForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<CreateMcpServerInput>(EMPTY_FORM)
  const [testResult, setTestResult] = useState<TestMcpConnectionResult | null>(
    null
  )
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)

  const create = useCreateMcpServer()

  const set = (patch: Partial<CreateMcpServerInput>) => {
    setForm((prev) => ({ ...prev, ...patch }))
    setTestResult(null)
    setTestError(null)
  }

  const applyTemplate = (t: ServerTemplate) => {
    setForm({
      name: t.label,
      url: t.url,
      transport: t.transport,
      authKind: t.authKind,
      authSecret: '',
      authHeaderName: t.authHeaderName ?? '',
    })
    setTestResult(null)
    setTestError(null)
  }

  const needsSecret = form.authKind !== 'none'
  const needsHeaderName = form.authKind === 'header'
  const canSubmit =
    form.name.trim().length > 0 &&
    form.url.trim().length > 0 &&
    (!needsSecret || (form.authSecret ?? '').length > 0) &&
    (!needsHeaderName || (form.authHeaderName ?? '').trim().length > 0)

  const runTest = async () => {
    setTesting(true)
    setTestError(null)
    setTestResult(null)
    try {
      const result = await testMcpConnection({
        endpoint: form.url.trim(),
        name: form.name.trim() || 'probe',
        transport: form.transport,
        authKind: form.authKind,
        authSecret: form.authSecret,
        authHeaderName: form.authHeaderName,
      })
      setTestResult(result)
    } catch (e) {
      setTestError(
        e instanceof McpRegistryRequestError
          ? e.message
          : 'Test connection failed'
      )
    } finally {
      setTesting(false)
    }
  }

  const submit = () => {
    if (!canSubmit) return
    create.mutate(
      {
        name: form.name.trim(),
        url: form.url.trim(),
        transport: form.transport,
        authKind: form.authKind,
        authSecret: needsSecret ? form.authSecret : undefined,
        authHeaderName: needsHeaderName
          ? form.authHeaderName?.trim()
          : undefined,
      },
      { onSuccess: onClose }
    )
  }

  return (
    <Card className="rounded-xl border bg-card shadow-sm">
      <CardContent className="space-y-3 p-4">
        {/* Template library */}
        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-[11px] uppercase tracking-wide">
            Start from a template
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((t) => (
              <Button
                key={t.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[12px]"
                onClick={() => applyTemplate(t)}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mcp-name" className="text-[12px]">
              Name
            </Label>
            <Input
              id="mcp-name"
              value={form.name}
              placeholder="My MCP server"
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-transport" className="text-[12px]">
              Transport
            </Label>
            <Select
              value={form.transport}
              onValueChange={(v) => set({ transport: v as McpTransport })}
            >
              <SelectTrigger id="mcp-transport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="http">HTTP (streamable)</SelectItem>
                <SelectItem value="sse">SSE</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mcp-url" className="text-[12px]">
            Endpoint URL
          </Label>
          <Input
            id="mcp-url"
            type="url"
            value={form.url}
            placeholder="https://…/mcp"
            onChange={(e) => set({ url: e.target.value })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mcp-auth" className="text-[12px]">
              Authentication
            </Label>
            <Select
              value={form.authKind}
              onValueChange={(v) => set({ authKind: v as McpAuthKind })}
            >
              <SelectTrigger id="mcp-auth">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="bearer">Bearer token</SelectItem>
                <SelectItem value="header">Custom header</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {needsHeaderName && (
            <div className="space-y-1.5">
              <Label htmlFor="mcp-header" className="text-[12px]">
                Header name
              </Label>
              <Input
                id="mcp-header"
                value={form.authHeaderName ?? ''}
                placeholder="Authorization"
                onChange={(e) => set({ authHeaderName: e.target.value })}
              />
            </div>
          )}
        </div>

        {needsSecret && (
          <div className="space-y-1.5">
            <Label htmlFor="mcp-secret" className="text-[12px]">
              {form.authKind === 'bearer' ? 'Bearer token' : 'Header value'}
            </Label>
            <Input
              id="mcp-secret"
              type="password"
              autoComplete="off"
              value={form.authSecret ?? ''}
              placeholder="Stored encrypted; never shown again"
              onChange={(e) => set({ authSecret: e.target.value })}
            />
          </div>
        )}

        {/* Test result */}
        {testResult?.status === 'connected' && (
          <Alert className="border-emerald-500/40">
            <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
            <AlertDescription>
              Connected — {testResult.toolCount} tool
              {testResult.toolCount === 1 ? '' : 's'} advertised
              {testResult.tools.length > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  ({testResult.tools.slice(0, 6).join(', ')}
                  {testResult.tools.length > 6 ? '…' : ''})
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}
        {(testResult?.status === 'error' || testError) && (
          <Alert variant="destructive">
            <XCircleIcon className="size-4" />
            <AlertDescription>
              {testError ?? testResult?.error ?? 'Could not connect'}
            </AlertDescription>
          </Alert>
        )}
        {create.error && (
          <Alert variant="destructive">
            <XCircleIcon className="size-4" />
            <AlertDescription>
              {create.error instanceof Error
                ? create.error.message
                : 'Failed to save server'}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={!form.url.trim() || testing}
            onClick={runTest}
          >
            {testing ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <PlugZapIcon className="size-3.5" />
            )}
            Test connection
          </Button>
          <div className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={!canSubmit || create.isPending}
            onClick={submit}
          >
            {create.isPending && (
              <Loader2Icon className="mr-1 size-3.5 animate-spin" />
            )}
            Save server
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function McpServerManager() {
  const { servers, isLoading, error, notEnabled } = useMcpRegistryServers()
  const [showAdd, setShowAdd] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    )
  }

  if (notEnabled) {
    return (
      <EmptyState
        variant="no-data"
        icon={<ServerIcon className="size-6" strokeWidth={1.5} />}
        title="MCP registry not enabled"
        description="Registering external MCP servers per user requires the hosted (cloud) deployment with a signed-in account. On self-hosted, add custom servers from the agent's MCP panel instead."
      />
    )
  }

  if (error) {
    return (
      <EmptyState
        variant="error"
        title="Couldn’t load your MCP servers"
        description={error.message}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-[13px]">
          {servers.length === 0
            ? 'No servers registered yet.'
            : `${servers.length} server${servers.length === 1 ? '' : 's'} · loaded with the agent’s built-in tools`}
        </p>
        {!showAdd && (
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setShowAdd(true)}
          >
            <PlusIcon className="size-3.5" />
            Add server
          </Button>
        )}
      </div>

      {showAdd && <AddServerForm onClose={() => setShowAdd(false)} />}

      {servers.length > 0 && (
        <Card
          className={cn('overflow-hidden rounded-xl border bg-card shadow-sm')}
        >
          <div className="divide-border divide-y">
            {servers.map((server) => (
              <ServerRow key={server.id} server={server} />
            ))}
          </div>
        </Card>
      )}

      {servers.length === 0 && !showAdd && (
        <EmptyState
          variant="no-data"
          icon={<ServerIcon className="size-6" strokeWidth={1.5} />}
          title="Register your first MCP server"
          description="Connect an external Model Context Protocol server (Slack, GitHub, Datadog, or any HTTP/SSE endpoint). Its tools become available to the agent."
          action={{
            label: 'Add server',
            onClick: () => setShowAdd(true),
          }}
        />
      )}
    </div>
  )
}
