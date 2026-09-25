'use client'

import { Eye, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import type {
  CustomWebhookFormat,
  CustomWebhookTargetPublic,
} from '@/lib/health/custom-webhook-targets'
import type {
  CustomWebhookPreviewResponse,
  CustomWebhookTargetInput,
} from '@/lib/hooks/use-custom-webhook-targets'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { describeError } from '@/lib/swr/fetch-error'

const FORMAT_OPTIONS: { value: CustomWebhookFormat; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'raw', label: 'Raw JSON' },
  { value: 'slack', label: 'Slack' },
  { value: 'matrix', label: 'Element / Matrix' },
]

function parseHeaders(value: string): Record<string, string> {
  if (!value.trim()) return {}
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Headers must be a JSON object')
  }
  return parsed as Record<string, string>
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : describeError(error) || 'Unknown error'
}

function draftFromTarget(target: CustomWebhookTargetPublic | null) {
  return {
    name: target?.name ?? '',
    url: '',
    enabled: target?.enabled ?? true,
    format: (target?.format ?? 'auto') as CustomWebhookFormat,
    minSeverity: target?.minSeverity ?? null,
    titleTemplate: target?.titleTemplate ?? '',
    bodyTemplate: target?.bodyTemplate ?? '',
    headers: JSON.stringify(target?.headers ?? {}, null, 2),
  }
}

export function CustomWebhookTargetCard({
  target,
  busy,
  onSave,
  onRemove,
  onPreview,
}: {
  target: CustomWebhookTargetPublic | null
  busy: boolean
  onSave: (input: CustomWebhookTargetInput) => Promise<void>
  onRemove: () => Promise<void>
  onPreview: (
    input: CustomWebhookTargetInput,
    send: boolean
  ) => Promise<CustomWebhookPreviewResponse>
}) {
  const [draft, setDraft] = useState(() => draftFromTarget(target))
  const [preview, setPreview] = useState<
    CustomWebhookPreviewResponse['preview'] | null
  >(null)
  const [inlineError, setInlineError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(draftFromTarget(target))
    setPreview(null)
    setInlineError(null)
  }, [target])

  const input = useMemo<CustomWebhookTargetInput>(() => {
    return {
      id: target?.id,
      name: draft.name,
      url: draft.url,
      enabled: draft.enabled,
      format: draft.format,
      minSeverity: draft.minSeverity,
      titleTemplate: draft.titleTemplate,
      bodyTemplate: draft.bodyTemplate,
      headers: {},
    }
  }, [draft, target])

  const update = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K]
  ) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setInlineError(null)
  }

  const handleRemove = async () => {
    try {
      await onRemove()
    } catch (error) {
      const message = errorMessage(error)
      setInlineError(message)
      toast.error('Failed to reset target', { description: message })
    }
  }

  const run = async (action: 'save' | 'preview' | 'send') => {
    try {
      const headers = parseHeaders(draft.headers)
      const payload = { ...input, headers }
      if (action === 'save') {
        await onSave(payload)
        return
      }
      const result = await onPreview(payload, action === 'send')
      setPreview(result.preview)
      if (action === 'send') toast.success('Custom webhook test sent')
    } catch (error) {
      const message = errorMessage(error)
      setInlineError(message)
      toast.error(
        action === 'save' ? 'Failed to save target' : 'Webhook action failed',
        {
          description: message,
        }
      )
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium">
              {target?.name || 'New custom webhook'}
            </h3>
            {target?.source === 'helm' && <Badge variant="outline">Helm</Badge>}
            {target?.source === 'd1' && <Badge variant="outline">D1</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Slack, Matrix, and raw payloads use the same server-side formatter
            as delivery.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label
            htmlFor="custom-webhook-enabled"
            className="text-xs text-muted-foreground"
          >
            Enabled
          </Label>
          <Switch
            id="custom-webhook-enabled"
            checked={draft.enabled}
            onCheckedChange={(checked) => update('enabled', checked)}
            disabled={busy || target?.editable === false}
            aria-label="Enable custom webhook"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="custom-webhook-name"
            className="text-xs text-muted-foreground"
          >
            Name
          </Label>
          <Input
            id="custom-webhook-name"
            value={draft.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="team-alerts"
            disabled={busy || target?.editable === false}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="custom-webhook-url"
            className="text-xs text-muted-foreground"
          >
            Webhook URL
          </Label>
          <Input
            id="custom-webhook-url"
            type="password"
            autoComplete="new-password"
            value={draft.url}
            onChange={(event) => update('url', event.target.value)}
            placeholder={
              target?.urlConfigured
                ? '•••• leave blank to keep the stored URL'
                : 'https://hooks.example.com/...'
            }
            disabled={busy || target?.editable === false}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="custom-webhook-format"
            className="text-xs text-muted-foreground"
          >
            Format
          </Label>
          <Select
            value={draft.format === 'raw-json' ? 'raw' : draft.format}
            onValueChange={(value) =>
              update('format', value as CustomWebhookFormat)
            }
            disabled={busy || target?.editable === false}
          >
            <SelectTrigger id="custom-webhook-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMAT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="custom-webhook-severity"
            className="text-xs text-muted-foreground"
          >
            Minimum severity
          </Label>
          <Select
            value={draft.minSeverity ?? 'inherit'}
            onValueChange={(value) =>
              update(
                'minSeverity',
                value === 'inherit' ? null : (value as 'warning' | 'critical')
              )
            }
            disabled={busy || target?.editable === false}
          >
            <SelectTrigger id="custom-webhook-severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Inherit global</SelectItem>
              <SelectItem value="warning">Warning and above</SelectItem>
              <SelectItem value="critical">Critical only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="custom-webhook-title"
            className="text-xs text-muted-foreground"
          >
            Title template
          </Label>
          <Input
            id="custom-webhook-title"
            value={draft.titleTemplate}
            onChange={(event) => update('titleTemplate', event.target.value)}
            placeholder="[{{severity}}] {{title}}"
            disabled={busy || target?.editable === false}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="custom-webhook-body"
            className="text-xs text-muted-foreground"
          >
            Body template
          </Label>
          <Input
            id="custom-webhook-body"
            value={draft.bodyTemplate}
            onChange={(event) => update('bodyTemplate', event.target.value)}
            placeholder="{{label}} on {{host}}"
            disabled={busy || target?.editable === false}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label
          htmlFor="custom-webhook-headers"
          className="text-xs text-muted-foreground"
        >
          Custom headers (JSON)
        </Label>
        <Textarea
          id="custom-webhook-headers"
          value={draft.headers}
          onChange={(event) => update('headers', event.target.value)}
          placeholder='{"X-Source":"chmonitor"}'
          className="min-h-20 font-mono text-xs"
          disabled={busy || target?.editable === false}
        />
        <p className="text-[11px] text-muted-foreground">
          Only bounded X-* headers are accepted. Use Kubernetes Secret
          references for credentials.
        </p>
      </div>

      {inlineError && (
        <p role="alert" className="text-xs text-destructive">
          {inlineError}
        </p>
      )}

      {preview && (
        <div
          className="flex flex-col gap-1 rounded-lg border bg-muted/20 p-2"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{preview.adapterId}</Badge>
            <span>{preview.redactedUrl}</span>
            {preview.truncated && <span>Body truncated</span>}
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed">
            {preview.bodyJson}
          </pre>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void run('preview')}
          disabled={busy || target?.editable === false}
        >
          <Eye className="size-3.5" strokeWidth={1.5} />
          Preview
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void run('send')}
          disabled={
            busy || target?.editable === false || !target?.urlConfigured
          }
        >
          <Send className="size-3.5" strokeWidth={1.5} />
          Send test
        </Button>
        {target?.editable && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleRemove()}
            disabled={busy}
          >
            <Trash2 className="size-3.5" strokeWidth={1.5} />
            Reset
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => void run('save')}
          disabled={busy || target?.editable === false}
        >
          Save
        </Button>
      </div>
    </div>
  )
}
