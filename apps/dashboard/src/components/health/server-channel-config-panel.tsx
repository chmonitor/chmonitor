/**
 * Server-persisted alert channel config panel (feat #2665).
 *
 * Makes the channels the cron sweep delivers to — previously env-only and shown
 * as read-only "Set HEALTH_ALERT_X on the server" status cards — editable from
 * the UI, backed by `/api/v1/health/alert-config` (per-owner D1). Each channel
 * is one form: enable switch + non-secret target fields + a write-only secret
 * input (masked placeholder when a secret is already stored — leave blank to
 * keep it) + a per-channel severity floor. Saving writes the D1 config the sweep
 * reads (`resolveServerChannels`: D1 row › env fallback).
 *
 * Fail-open: on a deployment with no D1 binding the API returns 501 on save and
 * an env-configured channel still works via its `HEALTH_ALERT_*` env vars — the
 * form shows an "env" badge so the operator knows a channel is already live.
 */

import { toast } from 'sonner'

import type { AlertConfigChannel } from '@/lib/hooks/use-alert-channel-config'

import { ChannelSeverityToggle } from './channel-severity-toggle'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  useAlertChannelConfig,
  useAlertChannelConfigMutations,
} from '@/lib/hooks/use-alert-channel-config'
import { describeError } from '@/lib/swr/fetch-error'

interface ChannelField {
  key: string
  label: string
  placeholder?: string
}

interface ChannelSpec {
  channel: AlertConfigChannel
  label: string
  description: string
  /** Non-secret target fields, in display order. */
  fields: ChannelField[]
  /** The channel's single secret, or `undefined` when it has none. */
  secret?: { label: string; placeholder: string; required: boolean }
}

/**
 * Server-side "send test" endpoints (POST, no body) that exercise the channel's
 * currently-configured server credentials. Webhook/healthchecks have no such
 * endpoint (they are tested client-side from the browser cards above), so they
 * are absent here. NOTE: these test the ENV-configured credentials today; a
 * saved D1 config becomes live for the cron sweep on its next run.
 */
const TEST_ENDPOINTS: Partial<Record<AlertConfigChannel, string>> = {
  email: '/api/v1/health/email-test',
  opsgenie: '/api/v1/health/opsgenie-test',
  telegram: '/api/v1/health/telegram-test',
  ntfy: '/api/v1/health/ntfy-test',
  pushover: '/api/v1/health/pushover-test',
  twilio: '/api/v1/health/twilio-test',
}

/** Field/secret contracts — MUST match `server-channel-resolve.ts`'s builders. */
const CHANNEL_SPECS: ChannelSpec[] = [
  {
    channel: 'webhook',
    label: 'Webhook',
    description:
      'POST a JSON payload to a Slack- or Discord-compatible URL on each alert.',
    fields: [
      {
        key: 'url',
        label: 'Webhook URL',
        placeholder: 'https://hooks.slack.com/services/...',
      },
    ],
  },
  {
    channel: 'healthchecks',
    label: 'healthchecks.io',
    description:
      'GET a healthchecks.io ping URL on each alert (append /fail on recovery).',
    fields: [
      {
        key: 'url',
        label: 'Ping URL',
        placeholder: 'https://hc-ping.com/your-uuid',
      },
    ],
  },
  {
    channel: 'email',
    label: 'Email',
    description: 'Send an email via Mailgun, SendGrid, or SMTP.',
    fields: [
      { key: 'from', label: 'From', placeholder: 'alerts@example.com' },
      {
        key: 'to',
        label: 'To (comma-separated)',
        placeholder: 'ops@example.com, oncall@example.com',
      },
    ],
    secret: {
      label: 'Provider URL',
      placeholder: 'mailgun://KEY@domain / sendgrid://KEY / smtp://…',
      required: true,
    },
  },
  {
    channel: 'opsgenie',
    label: 'Opsgenie',
    description: 'Create an Opsgenie alert via the Alert API.',
    fields: [{ key: 'region', label: 'Region (us | eu)', placeholder: 'us' }],
    secret: {
      label: 'API key',
      placeholder: 'Opsgenie API key',
      required: true,
    },
  },
  {
    channel: 'telegram',
    label: 'Telegram',
    description: 'Message a Telegram chat via a bot.',
    fields: [
      { key: 'chatId', label: 'Chat ID', placeholder: '-1001234567890' },
    ],
    secret: {
      label: 'Bot token',
      placeholder: '123456:ABC-DEF…',
      required: true,
    },
  },
  {
    channel: 'ntfy',
    label: 'ntfy',
    description: 'Publish to an ntfy topic (self-hostable).',
    fields: [
      {
        key: 'url',
        label: 'Topic URL',
        placeholder: 'https://ntfy.sh/your-topic',
      },
    ],
    secret: {
      label: 'Access token (optional)',
      placeholder: 'tk_… (only for protected topics)',
      required: false,
    },
  },
  {
    channel: 'pushover',
    label: 'Pushover',
    description: 'Notify a Pushover user/group via the Messages API.',
    fields: [{ key: 'user', label: 'User/group key', placeholder: 'u…' }],
    secret: {
      label: 'Application token',
      placeholder: 'a…',
      required: true,
    },
  },
  {
    channel: 'twilio',
    label: 'Twilio SMS',
    description:
      'Send an SMS via Twilio. Critical-only by default; each SMS costs money.',
    fields: [
      { key: 'accountSid', label: 'Account SID', placeholder: 'AC…' },
      { key: 'from', label: 'From number', placeholder: '+15557654321' },
      {
        key: 'to',
        label: 'To (comma-separated)',
        placeholder: '+15551234567, +15559876543',
      },
    ],
    secret: {
      label: 'Auth token',
      placeholder: 'Twilio auth token',
      required: true,
    },
  },
]

interface DraftState {
  enabled: boolean
  minSeverity: 'warning' | 'critical' | undefined
  target: Record<string, string>
  /** New secret typed by the operator; empty = keep the stored one. */
  secret: string
  hasSecret: boolean
}

function emptyDraft(): DraftState {
  return {
    enabled: false,
    minSeverity: undefined,
    target: {},
    secret: '',
    hasSecret: false,
  }
}

export function ServerChannelConfigPanel() {
  const { configs, env, isLoading } = useAlertChannelConfig()
  const { upsertChannel, deleteChannel } = useAlertChannelConfigMutations()

  const [drafts, setDrafts] = useState<Record<string, DraftState>>({})
  const [savingChannel, setSavingChannel] = useState<string | null>(null)

  // Hydrate drafts from the server config whenever it (re)loads.
  useEffect(() => {
    const next: Record<string, DraftState> = {}
    for (const spec of CHANNEL_SPECS) {
      const cfg = configs.find((c) => c.channel === spec.channel)
      next[spec.channel] = cfg
        ? {
            enabled: cfg.enabled,
            minSeverity: cfg.minSeverity ?? undefined,
            target: { ...cfg.target },
            secret: '',
            hasSecret: cfg.hasSecret,
          }
        : emptyDraft()
    }
    setDrafts(next)
  }, [configs])

  const setDraft = (channel: string, patch: Partial<DraftState>) =>
    setDrafts((prev) => ({
      ...prev,
      [channel]: { ...(prev[channel] ?? emptyDraft()), ...patch },
    }))

  const setTargetField = (channel: string, key: string, value: string) =>
    setDrafts((prev) => {
      const draft = prev[channel] ?? emptyDraft()
      return {
        ...prev,
        [channel]: { ...draft, target: { ...draft.target, [key]: value } },
      }
    })

  const handleSave = async (spec: ChannelSpec) => {
    const draft = drafts[spec.channel] ?? emptyDraft()
    setSavingChannel(spec.channel)
    try {
      await upsertChannel({
        channel: spec.channel,
        enabled: draft.enabled,
        minSeverity: draft.minSeverity ?? null,
        target: draft.target,
        secret: draft.secret || undefined,
      })
      toast.success(`${spec.label} channel saved`)
    } catch (err) {
      toast.error(`Failed to save ${spec.label}`, {
        description: describeError(err),
      })
    } finally {
      setSavingChannel(null)
    }
  }

  const handleTest = async (spec: ChannelSpec) => {
    const endpoint = TEST_ENDPOINTS[spec.channel]
    if (!endpoint) return
    setSavingChannel(spec.channel)
    try {
      const res = await fetch(endpoint, { method: 'POST' })
      const body = (await res.json().catch(() => null)) as {
        success?: boolean
        error?: { message?: string }
      } | null
      if (res.ok && body?.success !== false) {
        toast.success(`${spec.label} test sent`)
      } else {
        toast.error(`${spec.label} test failed`, {
          description: body?.error?.message ?? `HTTP ${res.status}`,
        })
      }
    } catch (err) {
      toast.error(`${spec.label} test failed`, {
        description: describeError(err),
      })
    } finally {
      setSavingChannel(null)
    }
  }

  const handleReset = async (spec: ChannelSpec) => {
    setSavingChannel(spec.channel)
    try {
      await deleteChannel(spec.channel)
      toast.success(`${spec.label} reset to server env default`)
    } catch (err) {
      toast.error(`Failed to reset ${spec.label}`, {
        description: describeError(err),
      })
    } finally {
      setSavingChannel(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label className="text-sm font-medium">Server delivery channels</Label>
        <span className="text-xs text-muted-foreground">
          Persisted on the server and used by the automated health sweep. A
          saved channel overrides its{' '}
          <code className="text-xs">HEALTH_ALERT_*</code> environment variable;
          leave a secret blank to keep the stored one.
        </span>
      </div>

      {CHANNEL_SPECS.map((spec, idx) => {
        const draft = drafts[spec.channel] ?? emptyDraft()
        const hasRow = configs.some((c) => c.channel === spec.channel)
        const envConfigured = Boolean(env[spec.channel])
        return (
          <div key={spec.channel}>
            {idx > 0 && <Separator className="mb-4" />}
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium">{spec.label}</Label>
                    {!hasRow && envConfigured && (
                      <Badge variant="secondary">
                        Configured via server env
                      </Badge>
                    )}
                    {draft.hasSecret && (
                      <Badge variant="outline">Secret set</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {spec.description}
                  </span>
                </div>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(checked) =>
                    setDraft(spec.channel, { enabled: checked })
                  }
                  disabled={isLoading}
                />
              </div>

              {spec.fields.map((field) => (
                <div key={field.key} className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">
                    {field.label}
                  </Label>
                  <Input
                    placeholder={field.placeholder}
                    value={draft.target[field.key] ?? ''}
                    onChange={(e) =>
                      setTargetField(spec.channel, field.key, e.target.value)
                    }
                  />
                </div>
              ))}

              {spec.secret && (
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">
                    {spec.secret.label}
                  </Label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      draft.hasSecret
                        ? '•••• leave blank to keep the stored secret'
                        : spec.secret.placeholder
                    }
                    value={draft.secret}
                    onChange={(e) =>
                      setDraft(spec.channel, { secret: e.target.value })
                    }
                  />
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Minimum severity
                  </span>
                  <ChannelSeverityToggle
                    value={draft.minSeverity}
                    onChange={(v) => setDraft(spec.channel, { minSeverity: v })}
                  />
                </div>
                <div className="flex items-center gap-2">
                  {TEST_ENDPOINTS[spec.channel] && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleTest(spec)}
                      disabled={savingChannel === spec.channel}
                    >
                      Send test
                    </Button>
                  )}
                  {hasRow && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleReset(spec)}
                      disabled={savingChannel === spec.channel}
                    >
                      Reset
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => void handleSave(spec)}
                    disabled={savingChannel === spec.channel}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
