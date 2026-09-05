'use client'

import {
  CheckCircle2Icon,
  Loader2Icon,
  PlugZapIcon,
  XCircleIcon,
} from 'lucide-react'

import type {
  McpAuthKind,
  McpTransport,
  TestMcpConnectionResult,
} from '@/lib/swr/use-mcp-registry'

import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  MCP_SERVER_TEMPLATES,
  type McpServerTemplate,
} from '@/lib/ai/agent/mcp/server-templates'
import {
  type CreateMcpServerInput,
  McpRegistryRequestError,
  testMcpConnection,
  useCreateMcpServer,
} from '@/lib/swr/use-mcp-registry'

const EMPTY_FORM: CreateMcpServerInput = {
  name: '',
  url: '',
  transport: 'http',
  authKind: 'none',
  authSecret: '',
  authHeaderName: '',
}

export function AddServerForm({ onClose }: { onClose: () => void }) {
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

  const applyTemplate = (t: McpServerTemplate) => {
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
        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-[11px] uppercase tracking-wide">
            Start from a template
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {MCP_SERVER_TEMPLATES.map((t) => (
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
