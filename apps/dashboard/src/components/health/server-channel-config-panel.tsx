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

import {
  HeartPulse,
  Mail,
  MessageCircle,
  Radio,
  Send,
  Siren,
  Smartphone,
  Webhook,
} from 'lucide-react'
import { toast } from 'sonner'

import type { ReactNode } from 'react'
import type { AlertConfigChannel } from '@/lib/hooks/use-alert-channel-config'

import {
  AddChannelTile,
  ChannelCard,
  ChannelSectionHeader,
} from './channel-card'
import { ChannelSeverityToggle } from './channel-severity-toggle'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  isServerChannelConfigured,
  partitionChannels,
} from '@/lib/health/channel-classification'
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
  icon: ReactNode
  /** Example target value shown on the compact "add a channel" tile. */
  example?: string
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
    icon: <Webhook strokeWidth={1.5} />,
    example: 'https://hooks.slack.com/services/T000/B000/XXXX',
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
    icon: <HeartPulse strokeWidth={1.5} />,
    example: 'https://hc-ping.com/your-uuid',
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
    icon: <Mail strokeWidth={1.5} />,
    example: 'mailgun://KEY@domain → ops@example.com',
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
    icon: <Siren strokeWidth={1.5} />,
    example: 'Alert API key · region us | eu',
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
    icon: <Send strokeWidth={1.5} />,
    example: 'bot token · chat id -1001234567890',
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
    icon: <Radio strokeWidth={1.5} />,
    example: 'https://ntfy.sh/your-topic',
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
    icon: <Smartphone strokeWidth={1.5} />,
    example: 'user key u… · app token a…',
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
    icon: <MessageCircle strokeWidth={1.5} />,
    example: '+15557654321 → +15551234567',
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
  // Channels opened from an "Add a channel" tile this session — they render as
  // full (expanded) cards before they hold any saved config.
  const [opened, setOpened] = useState<string[]>([])

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

  const isConfigured = (spec: ChannelSpec) =>
    isServerChannelConfigured({
      hasRow: configs.some((c) => c.channel === spec.channel),
      envConfigured: Boolean(env[spec.channel]),
    }) || opened.includes(spec.channel)

  const { configured, available } = partitionChannels(
    CHANNEL_SPECS,
    isConfigured
  )

  const renderCard = (spec: ChannelSpec) => {
    const draft = drafts[spec.channel] ?? emptyDraft()
    const hasRow = configs.some((c) => c.channel === spec.channel)
    const envConfigured = Boolean(env[spec.channel])
    return (
      <ChannelCard
        key={spec.channel}
        icon={spec.icon}
        title={spec.label}
        status={`${draft.enabled ? 'Enabled' : 'Disabled'} · ${
          draft.minSeverity === 'warning'
            ? 'Warning+'
            : draft.minSeverity === 'critical'
              ? 'Critical only'
              : 'Inherits default'
        }`}
        badges={
          <>
            {!hasRow && envConfigured && <Badge variant="secondary">env</Badge>}
            {draft.hasSecret && <Badge variant="outline">Secret set</Badge>}
          </>
        }
        enabled={draft.enabled}
        onEnabledChange={(checked) =>
          setDraft(spec.channel, { enabled: checked })
        }
        switchDisabled={isLoading}
        defaultOpen={opened.includes(spec.channel)}
      >
        <p className="text-xs text-muted-foreground">{spec.description}</p>

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

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Minimum severity
          </span>
          <ChannelSeverityToggle
            value={draft.minSeverity}
            onChange={(v) => setDraft(spec.channel, { minSeverity: v })}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
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
      </ChannelCard>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ChannelSectionHeader
        icon={<Siren className="size-4" strokeWidth={1.5} />}
        title="Server delivery channels"
        description={
          <>
            Persisted on the server and used by the automated health sweep. A
            saved channel overrides its{' '}
            <code className="text-xs">HEALTH_ALERT_*</code> environment
            variable; leave a secret blank to keep the stored one. Each card
            saves on its own.
          </>
        }
        count={configured.length}
      />

      {configured.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {configured.map(renderCard)}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed bg-card/50 p-4">
          <EmptyState
            variant="no-data"
            icon={<Siren className="size-5" strokeWidth={1.5} />}
            title="No server channel configured"
            description="The automated health sweep has nowhere to deliver yet. Add one below, or set the matching HEALTH_ALERT_* environment variables on the server."
          />
        </div>
      )}

      {available.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Add a channel
          </span>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((spec) => (
              <AddChannelTile
                key={spec.channel}
                icon={spec.icon}
                title={spec.label}
                description={spec.description}
                example={spec.example}
                onClick={() =>
                  setOpened((prev) => [...prev, spec.channel as string])
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
