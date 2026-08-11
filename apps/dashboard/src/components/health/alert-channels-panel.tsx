import { BellRing, HeartPulse, Laptop, Webhook } from 'lucide-react'

import type { ReactNode } from 'react'
import type { AlertSettings } from '@/lib/health/alert-settings-storage'
import type { LocalChannelId } from '@/lib/health/channel-classification'

import {
  AddChannelTile,
  ChannelCard,
  ChannelSectionHeader,
} from './channel-card'
import { ChannelSeverityToggle } from './channel-severity-toggle'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  isLocalChannelConfigured,
  LOCAL_CHANNEL_IDS,
  partitionChannels,
} from '@/lib/health/channel-classification'

interface LocalChannelMeta {
  id: LocalChannelId
  label: string
  icon: ReactNode
  /** One-line pitch for the compact "Add a channel" tile. */
  description: string
  example?: string
}

const LOCAL_CHANNELS: LocalChannelMeta[] = [
  {
    id: 'browser',
    label: 'Browser notifications',
    icon: <Laptop strokeWidth={1.5} />,
    description: 'Desktop notifications while this browser is open',
  },
  {
    id: 'healthchecks',
    label: 'healthchecks.io pings',
    icon: <HeartPulse strokeWidth={1.5} />,
    description: 'Ping a healthchecks.io check on each alert and recovery',
    example: 'https://hc-ping.com/your-uuid',
  },
  {
    id: 'webhook',
    label: 'Webhook alerts',
    icon: <Webhook strokeWidth={1.5} />,
    description: 'POST JSON to a Slack- or Discord-compatible URL',
    example: 'https://hooks.slack.com/services/T000/B000/XXXX',
  },
]

function severityLabel(value: 'warning' | 'critical' | undefined): string {
  if (value === 'warning') return 'Warning+'
  if (value === 'critical') return 'Critical only'
  return 'Inherits default'
}

export interface AlertChannelsPanelProps {
  alerts: AlertSettings
  setAlerts: (updater: (prev: AlertSettings) => AlertSettings) => void
  setChannelMinSeverity: (
    id: 'browser' | 'webhook' | 'healthchecks',
    minSeverity: 'warning' | 'critical' | undefined
  ) => void
  onEnableBrowser: (checked: boolean) => void
  onTestBrowser: () => void
  onTestHealthchecks: () => void
  onTestWebhook: () => void
}

/**
 * Browser-local delivery channels as a responsive card grid (issue: alert
 * settings redesign).
 *
 * Configured channels get a full collapsible card (icon, status, enable
 * switch, target field, severity floor, "Send test"); the rest are compact
 * "Add a channel" tiles that expand into the same card on click, so a fresh
 * install sees a short menu instead of a wall of blank forms. These settings
 * live in this browser's localStorage and persist with the page's Save button
 * — unlike the server channels, which save per card.
 */
export function AlertChannelsPanel({
  alerts,
  setAlerts,
  setChannelMinSeverity,
  onEnableBrowser,
  onTestBrowser,
  onTestHealthchecks,
  onTestWebhook,
}: AlertChannelsPanelProps) {
  // Ids the operator opened from an "Add a channel" tile this session; they
  // render as full (open) cards even before they hold a value.
  const [opened, setOpened] = useState<LocalChannelId[]>([])

  const { configured, available } = partitionChannels(
    LOCAL_CHANNEL_IDS,
    (id) => isLocalChannelConfigured(id, alerts) || opened.includes(id)
  )

  const meta = (id: LocalChannelId) =>
    LOCAL_CHANNELS.find((c) => c.id === id) as LocalChannelMeta

  const renderCard = (id: LocalChannelId) => {
    const m = meta(id)
    const channelSeverity = alerts.channels?.[id]?.minSeverity
    const severityRow = (
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Minimum severity</span>
        <ChannelSeverityToggle
          value={channelSeverity}
          onChange={(v) => setChannelMinSeverity(id, v)}
        />
      </div>
    )

    if (id === 'browser') {
      return (
        <ChannelCard
          key={id}
          icon={m.icon}
          title={m.label}
          status={`${alerts.browserNotificationsEnabled ? 'Enabled' : 'Disabled'} · ${severityLabel(channelSeverity)}`}
          enabled={alerts.browserNotificationsEnabled}
          onEnabledChange={onEnableBrowser}
          defaultOpen={opened.includes(id)}
        >
          <p className="text-xs text-muted-foreground">
            Show desktop notifications for new health alerts. Requires the
            browser notification permission.
          </p>
          {severityRow}
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={onTestBrowser}
              disabled={!alerts.browserNotificationsEnabled}
            >
              Send test
            </Button>
          </div>
        </ChannelCard>
      )
    }

    if (id === 'healthchecks') {
      return (
        <ChannelCard
          key={id}
          icon={m.icon}
          title={m.label}
          status={`${alerts.healthchecksUrl ? 'Ping URL set' : 'No ping URL'} · ${severityLabel(channelSeverity)}`}
          defaultOpen={opened.includes(id)}
        >
          <p className="text-xs text-muted-foreground">
            Send a GET ping to a healthchecks.io check URL on each alert
            (appends <code className="text-xs">/fail</code> automatically on
            recovery).
          </p>
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="healthchecks-url"
              className="text-xs text-muted-foreground"
            >
              Ping URL
            </Label>
            <Input
              id="healthchecks-url"
              placeholder="https://hc-ping.com/your-uuid"
              value={alerts.healthchecksUrl}
              onChange={(e) =>
                setAlerts((prev) => ({
                  ...prev,
                  healthchecksUrl: e.target.value.trim(),
                }))
              }
            />
          </div>
          {severityRow}
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={onTestHealthchecks}
              disabled={!alerts.healthchecksUrl}
            >
              Send test
            </Button>
          </div>
        </ChannelCard>
      )
    }

    return (
      <ChannelCard
        key={id}
        icon={m.icon}
        title={m.label}
        status={`${alerts.webhookEnabled ? 'Enabled' : 'Disabled'} · ${severityLabel(channelSeverity)}`}
        enabled={alerts.webhookEnabled}
        onEnabledChange={(checked) =>
          setAlerts((prev) => ({ ...prev, webhookEnabled: checked }))
        }
        defaultOpen={opened.includes(id)}
      >
        <p className="text-xs text-muted-foreground">
          POST a JSON payload to a Slack- or Discord-compatible URL.
        </p>
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="webhook-url"
            className="text-xs text-muted-foreground"
          >
            Webhook URL
          </Label>
          <Input
            id="webhook-url"
            placeholder="https://hooks.slack.com/services/..."
            value={alerts.webhookUrl}
            onChange={(e) =>
              setAlerts((prev) => ({ ...prev, webhookUrl: e.target.value }))
            }
          />
        </div>
        {severityRow}
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onTestWebhook}
            disabled={!alerts.webhookUrl}
          >
            Send test
          </Button>
        </div>
      </ChannelCard>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ChannelSectionHeader
        icon={<BellRing className="size-4" strokeWidth={1.5} />}
        title="Browser channels"
        description="Delivered by this browser while the dashboard is open, and stored locally on this device — press Save below to persist them."
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
            icon={<BellRing className="size-5" strokeWidth={1.5} />}
            title="No browser channel configured"
            description="Pick a channel below to get alerted — desktop notifications, a healthchecks.io ping URL, or a Slack/Discord webhook."
          />
        </div>
      )}

      {available.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Add a channel
          </span>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {available.map((id) => {
              const m = meta(id)
              return (
                <AddChannelTile
                  key={id}
                  icon={m.icon}
                  title={m.label}
                  description={m.description}
                  example={m.example}
                  onClick={() => setOpened((prev) => [...prev, id])}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
