import { Settings } from 'lucide-react'
import { toast } from 'sonner'

import type { AlertChannelId } from '@/lib/health/alert-channel-settings'

import { ActiveAlertsPanel } from './active-alerts-panel'
import { AlertRoutingPanel } from './alert-routing-dialog'
import { AlertSuggestionsPanel } from './alert-suggestions-panel'
import { HEALTH_CHECKS } from './health-checks'
import { MaintenanceWindowsPanel } from './maintenance-windows-panel'
import { QuietHoursPanel } from './quiet-hours-panel'
import { RecentAlertsCard } from './recent-alerts-card'
import { RuleBuilderPanel } from './rule-builder'
import { WebhookSubscriptionsPanel } from './webhook-subscriptions-panel'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  fireBrowserNotification,
  fireHealthchecks,
  fireWebhook,
} from '@/lib/health/alert-dispatcher'
import {
  type AlertSettings,
  DEFAULT_ALERT_SETTINGS,
  loadAlertSettings,
  saveAlertSettings,
} from '@/lib/health/alert-settings-storage'
import {
  loadThresholds,
  saveThresholds,
  type ThresholdsMap,
} from '@/lib/health/thresholds-storage'
import { describeError } from '@/lib/swr/fetch-error'
import { cn } from '@/lib/utils'

/**
 * Per-channel severity override control (#2661): a compact 3-way toggle —
 * Inherit (use the global gate) / Warning+ / Critical — mirroring the global
 * "Warning+ / Critical only" toggle's style. `Inherit` clears the channel's
 * `minSeverity` so it follows the global {@link AlertSettings.minSeverity}.
 */
function ChannelSeverityToggle({
  value,
  onChange,
}: {
  value: 'warning' | 'critical' | undefined
  onChange: (next: 'warning' | 'critical' | undefined) => void
}) {
  const options: {
    label: string
    val: 'warning' | 'critical' | undefined
  }[] = [
    { label: 'Inherit', val: undefined },
    { label: 'Warning+', val: 'warning' },
    { label: 'Critical', val: 'critical' },
  ]
  return (
    <div className="flex items-center gap-1 text-xs">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          className={cn(
            'rounded-md px-2 py-1',
            value === o.val ? 'bg-secondary' : 'text-muted-foreground'
          )}
          onClick={() => onChange(o.val)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function HealthSettingsDialog() {
  const [open, setOpen] = useState(false)
  const [thresholds, setThresholdsState] = useState<ThresholdsMap>({})
  const [alerts, setAlerts] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS)
  const [opsgenieStatus, setOpsgenieStatus] = useState<{
    configured: boolean
    region: string | null
  } | null>(null)
  const [telegramStatus, setTelegramStatus] = useState<{
    configured: boolean
  } | null>(null)
  const [ntfyStatus, setNtfyStatus] = useState<{
    configured: boolean
  } | null>(null)
  const [twilioStatus, setTwilioStatus] = useState<{
    configured: boolean
    recipients: number
  } | null>(null)
  const [pushoverStatus, setPushoverStatus] = useState<{
    configured: boolean
  } | null>(null)

  useEffect(() => {
    if (!open) return
    setThresholdsState(loadThresholds())
    setAlerts(loadAlertSettings())
    fetch('/api/v1/health/opsgenie-test')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) =>
        setOpsgenieStatus(
          data as { configured: boolean; region: string | null } | null
        )
      )
      .catch(() => setOpsgenieStatus(null))
    fetch('/api/v1/health/telegram-test')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setTelegramStatus(data as { configured: boolean } | null))
      .catch(() => setTelegramStatus(null))
    fetch('/api/v1/health/ntfy-test')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setNtfyStatus(data as { configured: boolean } | null))
      .catch(() => setNtfyStatus(null))
    fetch('/api/v1/health/twilio-test')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) =>
        setTwilioStatus(
          data as { configured: boolean; recipients: number } | null
        )
      )
      .catch(() => setTwilioStatus(null))
    fetch('/api/v1/health/pushover-test')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setPushoverStatus(data as { configured: boolean } | null))
      .catch(() => setPushoverStatus(null))
  }, [open])

  const handleThresholdChange = (
    id: string,
    kind: 'warning' | 'critical',
    raw: string
  ) => {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    setThresholdsState((prev) => {
      const def = HEALTH_CHECKS.find((c) => c.id === id)?.defaults
      const current = prev[id] ?? def ?? { warning: 0, critical: 0 }
      return { ...prev, [id]: { ...current, [kind]: n } }
    })
  }

  const handleReset = (id: string) => {
    setThresholdsState((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const invalidCheck = HEALTH_CHECKS.find((check) => {
    const current = thresholds[check.id] ?? check.defaults
    return current.warning > current.critical
  })

  const handleSave = () => {
    if (invalidCheck) {
      toast.error(`${invalidCheck.title}: warning must be ≤ critical`)
      return
    }
    const thresholdsSaved = saveThresholds(thresholds)
    const alertsSaved = saveAlertSettings(alerts)
    if (thresholdsSaved && alertsSaved) {
      toast.success('Health settings saved')
      setOpen(false)
      return
    }
    toast.error(
      'Failed to save health settings. Check browser storage permissions.'
    )
  }

  // Per-channel min-severity override (#2661). Setting `undefined` (Inherit)
  // clears the field, and an override with nothing left drops the channel key
  // entirely, so a fresh install keeps the exact default shape.
  const setChannelMinSeverity = (
    id: AlertChannelId,
    minSeverity: 'warning' | 'critical' | undefined
  ) => {
    setAlerts((prev) => {
      const channels = { ...(prev.channels ?? {}) }
      const entry = { ...(channels[id] ?? {}) }
      if (minSeverity) entry.minSeverity = minSeverity
      else delete entry.minSeverity
      if (entry.enabled === undefined && entry.minSeverity === undefined) {
        delete channels[id]
      } else {
        channels[id] = entry
      }
      return {
        ...prev,
        channels: Object.keys(channels).length > 0 ? channels : undefined,
      }
    })
  }

  const handleEnableBrowser = async (checked: boolean) => {
    if (checked) {
      if (!('Notification' in window)) {
        toast.error('Browser notifications are not supported in this browser')
        return
      }
      if (Notification.permission === 'default') {
        try {
          const result = await Notification.requestPermission()
          if (result !== 'granted') {
            toast.error('Browser notifications were not granted')
            return
          }
        } catch (err) {
          toast.error('Failed to request browser notification permission', {
            description: describeError(err),
          })
          return
        }
      } else if (Notification.permission === 'denied') {
        toast.error(
          'Browser notifications are blocked. Enable them in your browser settings.'
        )
        return
      }
    }
    setAlerts((prev) => ({ ...prev, browserNotificationsEnabled: checked }))
  }

  const handleTestHealthchecks = async () => {
    if (!alerts.healthchecksUrl) {
      toast.error('Enter a healthchecks.io ping URL first')
      return
    }
    const ok = await fireHealthchecks(alerts.healthchecksUrl, 'alert')
    if (ok) toast.success('healthchecks.io test ping sent')
    else toast.error('healthchecks.io ping failed')
  }

  const handleTestWebhook = async () => {
    if (!alerts.webhookUrl) {
      toast.error('Enter a webhook URL first')
      return
    }
    const ok = await fireWebhook(
      {
        checkId: 'test',
        title: 'Test Alert',
        severity: 'warning',
        value: 0,
        label: 'This is a test alert from chmonitor',
        hostId: 0,
      },
      alerts.webhookUrl
    )
    if (ok) toast.success('Test alert sent')
    else toast.error('Webhook request failed')
  }

  const handleTestOpsgenie = async () => {
    try {
      const res = await fetch('/api/v1/health/opsgenie-test', {
        method: 'POST',
      })
      if (res.ok) {
        toast.success('Opsgenie test alert sent')
      } else {
        const body = await res.json().catch(() => null)
        toast.error('Opsgenie test alert failed', {
          description:
            (body as { error?: { message?: string } } | null)?.error?.message ??
            `HTTP ${res.status}`,
        })
      }
    } catch (err) {
      toast.error('Opsgenie test alert failed', {
        description: describeError(err),
      })
    }
  }

  const handleTestTelegram = async () => {
    try {
      const res = await fetch('/api/v1/health/telegram-test', {
        method: 'POST',
      })
      if (res.ok) {
        toast.success('Telegram test message sent')
      } else {
        const body = await res.json().catch(() => null)
        toast.error('Telegram test message failed', {
          description:
            (body as { error?: { message?: string } } | null)?.error?.message ??
            `HTTP ${res.status}`,
        })
      }
    } catch (err) {
      toast.error('Telegram test message failed', {
        description: describeError(err),
      })
    }
  }

  const handleTestNtfy = async () => {
    try {
      const res = await fetch('/api/v1/health/ntfy-test', { method: 'POST' })
      if (res.ok) {
        toast.success('ntfy test notification sent')
      } else {
        const body = await res.json().catch(() => null)
        toast.error('ntfy test notification failed', {
          description:
            (body as { error?: { message?: string } } | null)?.error?.message ??
            `HTTP ${res.status}`,
        })
      }
    } catch (err) {
      toast.error('ntfy test notification failed', {
        description: describeError(err),
      })
    }
  }

  const handleTestPushover = async () => {
    try {
      const res = await fetch('/api/v1/health/pushover-test', {
        method: 'POST',
      })
      if (res.ok) {
        toast.success('Pushover test notification sent')
      } else {
        const body = await res.json().catch(() => null)
        toast.error(
          (body as { error?: { message?: string } } | null)?.error?.message ??
            'Pushover test notification failed'
        )
      }
    } catch {
      toast.error('Pushover test notification failed')
    }
  }

  const handleTestTwilio = async () => {
    try {
      const res = await fetch('/api/v1/health/twilio-test', {
        method: 'POST',
      })
      if (res.ok) {
        toast.success('Twilio test SMS sent')
      } else {
        const body = await res.json().catch(() => null)
        toast.error(
          (body as { error?: { message?: string } } | null)?.error?.message ??
            'Twilio test SMS failed'
        )
      }
    } catch {
      toast.error('Twilio test SMS failed')
    }
  }

  const handleTestEmail = async () => {
    try {
      const res = await fetch('/api/v1/health/email-test', { method: 'POST' })
      const data = (await res.json().catch(() => null)) as {
        success?: boolean
        error?: { message?: string }
      } | null
      if (res.ok && data?.success) {
        toast.success('Test email sent')
      } else {
        toast.error('Failed to send test email', {
          description: data?.error?.message || `HTTP ${res.status}`,
        })
      }
    } catch (err) {
      toast.error('Failed to send test email', {
        description: describeError(err),
      })
    }
  }

  const handleTestBrowser = () => {
    if (!('Notification' in window)) {
      toast.error('Browser notifications are not supported in this browser')
      return
    }
    if (Notification.permission !== 'granted') {
      toast.error('Browser notifications are not granted')
      return
    }
    fireBrowserNotification({
      checkId: 'test',
      title: 'Test Alert',
      severity: 'warning',
      value: 0,
      label: 'This is a test alert from chmonitor',
      hostId: 0,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Settings className="mr-2 size-4" />
        Settings
      </DialogTrigger>
      <DialogContent className="flex h-[min(52rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Health Settings</DialogTitle>
          <DialogDescription>
            Configure per-check thresholds and alert delivery. Settings are
            stored locally in your browser.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="thresholds" className="min-h-0 flex-1">
          <div className="scrollbar-hide -mx-1 shrink-0 overflow-x-auto px-1 py-0.5">
            <TabsList className="w-max flex-nowrap">
              <TabsTrigger value="thresholds">Thresholds</TabsTrigger>
              <TabsTrigger value="alerts">Alerts</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="routing">Routing</TabsTrigger>
              <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
              <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
              <TabsTrigger value="quiet-hours">Quiet Hours</TabsTrigger>
              <TabsTrigger value="suggested">Suggested</TabsTrigger>
              <TabsTrigger value="custom-rules">Custom Rules</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="thresholds" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full pr-3">
              <div className="flex flex-col gap-3">
                {HEALTH_CHECKS.map((check) => {
                  const current = thresholds[check.id] ?? check.defaults
                  const isOverridden = thresholds[check.id] !== undefined
                  return (
                    <div
                      key={check.id}
                      className="flex flex-col gap-2 rounded-md border p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {check.title}
                        </span>
                        {isOverridden && (
                          <button
                            type="button"
                            onClick={() => handleReset(check.id)}
                            className="text-xs text-muted-foreground hover:underline"
                          >
                            Reset to default
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <Label
                            htmlFor={`${check.id}-warning`}
                            className="text-xs text-muted-foreground"
                          >
                            Warning ≥
                          </Label>
                          <Input
                            id={`${check.id}-warning`}
                            type="number"
                            inputMode="decimal"
                            value={current.warning}
                            onChange={(e) =>
                              handleThresholdChange(
                                check.id,
                                'warning',
                                e.target.value
                              )
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Label
                            htmlFor={`${check.id}-critical`}
                            className="text-xs text-muted-foreground"
                          >
                            Critical ≥
                          </Label>
                          <Input
                            id={`${check.id}-critical`}
                            type="number"
                            inputMode="decimal"
                            value={current.critical}
                            onChange={(e) =>
                              handleThresholdChange(
                                check.id,
                                'critical',
                                e.target.value
                              )
                            }
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="alerts" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full pr-3">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-sm font-medium">
                        Browser notifications
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        Show desktop notifications for new health alerts
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleTestBrowser}
                        disabled={!alerts.browserNotificationsEnabled}
                      >
                        Test
                      </Button>
                      <Switch
                        checked={alerts.browserNotificationsEnabled}
                        onCheckedChange={handleEnableBrowser}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Minimum severity
                    </span>
                    <ChannelSeverityToggle
                      value={alerts.channels?.browser?.minSeverity}
                      onChange={(v) => setChannelMinSeverity('browser', v)}
                    />
                  </div>
                </div>

                <Separator />

                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-sm font-medium">
                        healthchecks.io pings
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        Send a GET ping to a healthchecks.io check URL on each
                        alert (append <code className="text-xs">/fail</code>{' '}
                        automatically on recovery)
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="https://hc-ping.com/your-uuid"
                      value={alerts.healthchecksUrl}
                      onChange={(e) =>
                        setAlerts((prev) => ({
                          ...prev,
                          healthchecksUrl: e.target.value.trim(),
                        }))
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleTestHealthchecks()}
                      disabled={!alerts.healthchecksUrl}
                    >
                      Send test
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Minimum severity
                    </span>
                    <ChannelSeverityToggle
                      value={alerts.channels?.healthchecks?.minSeverity}
                      onChange={(v) => setChannelMinSeverity('healthchecks', v)}
                    />
                  </div>
                </div>

                <Separator />

                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-sm font-medium">
                        Webhook alerts
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        POST a JSON payload to a Slack- or Discord-compatible
                        URL
                      </span>
                    </div>
                    <Switch
                      checked={alerts.webhookEnabled}
                      onCheckedChange={(checked) =>
                        setAlerts((prev) => ({
                          ...prev,
                          webhookEnabled: checked,
                        }))
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="https://hooks.slack.com/services/..."
                      value={alerts.webhookUrl}
                      onChange={(e) =>
                        setAlerts((prev) => ({
                          ...prev,
                          webhookUrl: e.target.value,
                        }))
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleTestWebhook}
                      disabled={!alerts.webhookUrl}
                    >
                      Send test
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Minimum severity
                    </span>
                    <ChannelSeverityToggle
                      value={alerts.channels?.webhook?.minSeverity}
                      onChange={(v) => setChannelMinSeverity('webhook', v)}
                    />
                  </div>
                </div>

                <Separator />

                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <Label className="text-sm font-medium">
                        Email alerts
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        Configured by the server operator via{' '}
                        <code className="text-xs">HEALTH_ALERT_EMAIL_*</code>{' '}
                        environment variables (Mailgun, SendGrid, or SMTP)
                      </span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleTestEmail}>
                      Send test email
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">
                        Opsgenie alerts
                      </Label>
                      <Badge
                        variant={
                          opsgenieStatus?.configured ? 'default' : 'secondary'
                        }
                      >
                        {opsgenieStatus?.configured
                          ? `Configured (${opsgenieStatus.region})`
                          : 'Not configured'}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Set HEALTH_ALERT_OPSGENIE_API_KEY on the server to enable
                      — the key is never exposed to the browser
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleTestOpsgenie}
                    disabled={!opsgenieStatus?.configured}
                  >
                    Send test
                  </Button>
                </div>

                <Separator />

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">
                        Telegram alerts
                      </Label>
                      <Badge
                        variant={
                          telegramStatus?.configured ? 'default' : 'secondary'
                        }
                      >
                        {telegramStatus?.configured
                          ? 'Configured'
                          : 'Not configured'}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Set HEALTH_ALERT_TELEGRAM_BOT_TOKEN and
                      HEALTH_ALERT_TELEGRAM_CHAT_ID on the server to enable —
                      the bot token is never exposed to the browser
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleTestTelegram}
                    disabled={!telegramStatus?.configured}
                  >
                    Send test
                  </Button>
                </div>

                <Separator />

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">ntfy alerts</Label>
                      <Badge
                        variant={
                          ntfyStatus?.configured ? 'default' : 'secondary'
                        }
                      >
                        {ntfyStatus?.configured
                          ? 'Configured'
                          : 'Not configured'}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Set HEALTH_ALERT_NTFY_URL (and optional
                      HEALTH_ALERT_NTFY_TOKEN) on the server to enable — the
                      token is never exposed to the browser
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleTestNtfy}
                    disabled={!ntfyStatus?.configured}
                  >
                    Send test
                  </Button>
                </div>

                <Separator />

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">
                        Twilio SMS alerts
                      </Label>
                      <Badge
                        variant={
                          twilioStatus?.configured ? 'default' : 'secondary'
                        }
                      >
                        {twilioStatus?.configured
                          ? `Configured (${twilioStatus.recipients} recipient${twilioStatus.recipients === 1 ? '' : 's'})`
                          : 'Not configured'}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Set HEALTH_ALERT_TWILIO_ACCOUNT_SID,
                      HEALTH_ALERT_TWILIO_AUTH_TOKEN, HEALTH_ALERT_TWILIO_FROM,
                      and HEALTH_ALERT_TWILIO_TO on the server to enable —
                      critical alerts only by default, each SMS costs real
                      money, and the auth token is never exposed to the browser
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleTestTwilio}
                    disabled={!twilioStatus?.configured}
                  >
                    Send test
                  </Button>
                </div>

                <Separator />

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium">
                        Pushover alerts
                      </Label>
                      <Badge
                        variant={
                          pushoverStatus?.configured ? 'default' : 'secondary'
                        }
                      >
                        {pushoverStatus?.configured
                          ? 'Configured'
                          : 'Not configured'}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Set HEALTH_ALERT_PUSHOVER_TOKEN and
                      HEALTH_ALERT_PUSHOVER_USER on the server to enable — the
                      token is never exposed to the browser
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleTestPushover}
                    disabled={!pushoverStatus?.configured}
                  >
                    Send test
                  </Button>
                </div>

                <Separator />

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex flex-col">
                    <Label className="text-sm font-medium">
                      Minimum severity
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      Default floor — channels above inherit it unless they set
                      their own
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <button
                      type="button"
                      className={
                        alerts.minSeverity === 'warning'
                          ? 'rounded-md bg-secondary px-2 py-1'
                          : 'rounded-md px-2 py-1 text-muted-foreground'
                      }
                      onClick={() =>
                        setAlerts((prev) => ({
                          ...prev,
                          minSeverity: 'warning',
                        }))
                      }
                    >
                      Warning+
                    </button>
                    <button
                      type="button"
                      className={
                        alerts.minSeverity === 'critical'
                          ? 'rounded-md bg-secondary px-2 py-1'
                          : 'rounded-md px-2 py-1 text-muted-foreground'
                      }
                      onClick={() =>
                        setAlerts((prev) => ({
                          ...prev,
                          minSeverity: 'critical',
                        }))
                      }
                    >
                      Critical only
                    </button>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="active" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full pr-3">
              <ActiveAlertsPanel />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="history" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full pr-3">
              <RecentAlertsCard />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="routing" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full pr-3">
              <AlertRoutingPanel />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="webhooks" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full pr-3">
              <WebhookSubscriptionsPanel />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="maintenance" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full pr-3">
              <MaintenanceWindowsPanel />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="quiet-hours" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full pr-3">
              <QuietHoursPanel />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="suggested" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full pr-3">
              <AlertSuggestionsPanel />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="custom-rules" className="min-h-0 overflow-hidden">
            <ScrollArea className="h-full pr-3">
              <RuleBuilderPanel />
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
