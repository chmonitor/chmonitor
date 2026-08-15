'use client'

import { BellRing, HeartPulse, Laptop, Plus, Webhook } from 'lucide-react'

import type { ReactNode } from 'react'
import type { AlertSettings } from '@/lib/health/alert-settings-storage'
import type { LocalChannelId } from '@/lib/health/channel-classification'
import type { NotificationPermissionInfo } from '@/lib/health/use-notification-permission'

import {
  ChannelCard,
  ChannelPickerDialog,
  ChannelSectionHeader,
} from './channel-card'
import { ChannelSeverityToggle } from './channel-severity-toggle'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
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

/**
 * Status line for the browser channel — the stored preference AND the live
 * browser permission, because either one alone can silently stop delivery.
 */
function browserStatus(
  enabled: boolean,
  permission: NotificationPermissionInfo
): string {
  if (permission.state === 'unsupported') return 'Not supported in this browser'
  if (permission.state === 'denied') return 'Blocked in browser settings'
  if (!enabled) return 'Disabled'
  if (permission.state === 'default') return 'Permission not granted yet'
  return 'Delivering'
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
  /** Live browser notification permission (owned by the parent so it can gate its handlers too). */
  permission: NotificationPermissionInfo
}

/**
 * Browser-local delivery channels as a responsive card grid.
 *
 * Only channels that are ALREADY configured render as cards; the rest live
 * behind an "Add channel" dialog, so a fresh install sees a short menu instead
 * of a wall of blank forms. These settings live in this browser's localStorage
 * and persist with the page's Save button — unlike the server channels, which
 * save per card.
 *
 * The browser card additionally reflects the live `Notification.permission`
 * (see `useNotificationPermission`): the toggle used to show "on" while the
 * permission was still ungranted, which read as working when nothing was being
 * delivered.
 */
export function AlertChannelsPanel({
  alerts,
  setAlerts,
  setChannelMinSeverity,
  onEnableBrowser,
  onTestBrowser,
  onTestHealthchecks,
  onTestWebhook,
  permission,
}: AlertChannelsPanelProps) {
  // Ids the operator opened from the picker this session; they render as full
  // (open) cards even before they hold a value.
  const [opened, setOpened] = useState<LocalChannelId[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  const { configured, available } = partitionChannels(
    LOCAL_CHANNEL_IDS,
    (id) => isLocalChannelConfigured(id, alerts) || opened.includes(id)
  )

  const meta = (id: LocalChannelId) =>
    LOCAL_CHANNELS.find((c) => c.id === id) as LocalChannelMeta

  // Pin a card open once the operator interacts with it, so clearing its URL
  // (or switching it off) does not collapse the card back into the picker
  // mid-edit — which would unmount the input and drop focus.
  const pin = (id: LocalChannelId) =>
    setOpened((prev) => (prev.includes(id) ? prev : [...prev, id]))

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
      // The switch mirrors the *effective* state: the stored preference AND a
      // usable permission. We never write `false` into storage on a denial —
      // that would destroy the operator's intent and not come back when they
      // unblock the site.
      const effectivelyOn =
        alerts.browserNotificationsEnabled && permission.canNotify
      return (
        <ChannelCard
          key={id}
          icon={m.icon}
          title={m.label}
          badges={
            permission.state === 'denied' ? (
              <Badge variant="outline" className="text-xs">
                blocked
              </Badge>
            ) : permission.state === 'default' &&
              alerts.browserNotificationsEnabled ? (
              <Badge variant="outline" className="text-xs">
                needs permission
              </Badge>
            ) : undefined
          }
          status={`${browserStatus(alerts.browserNotificationsEnabled, permission)} · ${severityLabel(channelSeverity)}`}
          enabled={effectivelyOn}
          switchDisabled={
            permission.state === 'unsupported' || permission.state === 'denied'
          }
          onEnabledChange={(checked) => {
            pin(id)
            onEnableBrowser(checked)
          }}
          defaultOpen={opened.includes(id)}
        >
          <p className="text-xs text-muted-foreground">
            Show desktop notifications for new health alerts while this browser
            is open.
          </p>
          {permission.state === 'denied' && (
            <p className="text-xs text-muted-foreground">
              This site is blocked from sending notifications. Allow them in the
              browser's site settings (the icon left of the address bar), then
              this toggle re-enables itself.
            </p>
          )}
          {permission.state === 'unsupported' && (
            <p className="text-xs text-muted-foreground">
              This browser has no Notification API — use a webhook or
              healthchecks.io instead.
            </p>
          )}
          {permission.state === 'default' && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-dashed p-2">
              <span className="text-xs text-muted-foreground">
                Permission not granted yet
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  pin(id)
                  onEnableBrowser(true)
                }}
              >
                Allow notifications
              </Button>
            </div>
          )}
          {severityRow}
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={onTestBrowser}
              disabled={!effectivelyOn}
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
              onChange={(e) => {
                pin(id)
                setAlerts((prev) => ({
                  ...prev,
                  healthchecksUrl: e.target.value.trim(),
                }))
              }}
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
            onChange={(e) => {
              pin(id)
              setAlerts((prev) => ({ ...prev, webhookUrl: e.target.value }))
            }}
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
      <div className="flex items-start justify-between gap-2">
        <ChannelSectionHeader
          icon={<BellRing className="size-4" strokeWidth={1.5} />}
          title="Browser channels"
          description="Delivered by this browser while the dashboard is open, and stored locally on this device — press Save below to persist them."
          count={configured.length}
        />
        {available.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setPickerOpen(true)}
          >
            <Plus className="size-3.5" strokeWidth={1.5} />
            Add channel
          </Button>
        )}
      </div>

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
            description="Pick a channel to get alerted — desktop notifications, a healthchecks.io ping URL, or a Slack/Discord webhook."
            action={{
              label: 'Add channel',
              icon: <Plus className="size-3.5" strokeWidth={1.5} />,
              onClick: () => setPickerOpen(true),
            }}
          />
        </div>
      )}

      <ChannelPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Add a browser channel"
        description="Delivered by this browser while the dashboard is open. Stored locally on this device."
        items={available.map((id) => {
          const m = meta(id)
          return {
            id,
            label: m.label,
            description: m.description,
            icon: m.icon,
            example: m.example,
          }
        })}
        onPick={(id) => setOpened((prev) => [...prev, id as LocalChannelId])}
      />
    </div>
  )
}
