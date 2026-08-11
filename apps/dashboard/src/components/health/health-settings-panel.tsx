import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  Braces,
  CircleAlert,
  History,
  MoonStar,
  Route,
  SlidersHorizontal,
  Sparkles,
  Webhook,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'

import type { AlertChannelId } from '@/lib/health/alert-channel-settings'

import { ActiveAlertsPanel } from './active-alerts-panel'
import { AlertChannelsPanel } from './alert-channels-panel'
import { AlertRoutingPanel } from './alert-routing-dialog'
import { AlertStateCard } from './alert-state-card'
import { AlertSuggestionsPanel } from './alert-suggestions-panel'
import { DigestSettingsPanel } from './digest-settings-panel'
import { HEALTH_CHECKS } from './health-checks'
import { MaintenanceWindowsPanel } from './maintenance-windows-panel'
import { QuietHoursPanel } from './quiet-hours-panel'
import { RecentAlertsCard } from './recent-alerts-card'
import { RuleBuilderPanel } from './rule-builder'
import { ServerChannelConfigPanel } from './server-channel-config-panel'
import { WebhookSubscriptionsPanel } from './webhook-subscriptions-panel'
import { type ReactNode, useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
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

export const HEALTH_SETTINGS_TABS = [
  'thresholds',
  'alerts',
  'active',
  'history',
  'routing',
  'webhooks',
  'maintenance',
  'quiet-hours',
  'suggested',
  'custom-rules',
] as const

export type HealthSettingsTab = (typeof HEALTH_SETTINGS_TABS)[number]

/**
 * Tab strip definition — one place so every tab gets the same icon size and
 * spacing (the icons used to be hand-written with an extra `mr-1.5` on top of
 * the trigger's built-in gap, which read as misaligned).
 */
const TAB_DEFS: {
  value: HealthSettingsTab
  label: string
  icon: LucideIcon
}[] = [
  { value: 'thresholds', label: 'Thresholds', icon: SlidersHorizontal },
  { value: 'alerts', label: 'Alerts', icon: Bell },
  { value: 'active', label: 'Active', icon: CircleAlert },
  { value: 'history', label: 'History', icon: History },
  { value: 'routing', label: 'Routing', icon: Route },
  { value: 'webhooks', label: 'Webhooks', icon: Webhook },
  { value: 'maintenance', label: 'Maintenance', icon: Wrench },
  { value: 'quiet-hours', label: 'Quiet Hours', icon: MoonStar },
  { value: 'suggested', label: 'Suggested', icon: Sparkles },
  { value: 'custom-rules', label: 'Custom Rules', icon: Braces },
]

export function isHealthSettingsTab(
  value: string | undefined
): value is HealthSettingsTab {
  return (
    value !== undefined &&
    (HEALTH_SETTINGS_TABS as readonly string[]).includes(value)
  )
}

/**
 * Shared body of the health/alert settings surface — tabs, form state and
 * save logic. Rendered by the `/health-settings` and `/alert-settings` pages.
 */
export function HealthSettingsPanel({
  defaultTab = 'thresholds',
  footer,
}: {
  defaultTab?: HealthSettingsTab
  /** Renders the action row; receives the validated save handler. */
  footer: (save: () => boolean) => ReactNode
}) {
  const [thresholds, setThresholdsState] = useState<ThresholdsMap>({})
  const [alerts, setAlerts] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS)

  useEffect(() => {
    setThresholdsState(loadThresholds())
    setAlerts(loadAlertSettings())
  }, [])

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

  /** Validate + persist. Returns true when everything saved. */
  const handleSave = (): boolean => {
    if (invalidCheck) {
      toast.error(`${invalidCheck.title}: warning must be ≤ critical`)
      return false
    }
    const thresholdsSaved = saveThresholds(thresholds)
    const alertsSaved = saveAlertSettings(alerts)
    if (thresholdsSaved && alertsSaved) {
      toast.success('Health settings saved')
      return true
    }
    toast.error(
      'Failed to save health settings. Check browser storage permissions.'
    )
    return false
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

  // Plain render helper (not a component) so the element type stays stable
  // across renders — a nested component would remount the subtree and drop
  // input focus on each keystroke.
  const pane = (value: HealthSettingsTab, children: ReactNode) => (
    <TabsContent value={value} className="mt-2">
      {children}
    </TabsContent>
  )

  return (
    <>
      <Tabs defaultValue={defaultTab}>
        {/* One scrollable, non-wrapping strip. Icons carry no margin — the
            trigger's own `items-center gap-1.5` aligns them with the label, and
            a single `size-3.5` keeps every tab's glyph the same weight. */}
        <div className="scrollbar-hide -mx-1 shrink-0 overflow-x-auto px-1 py-0.5">
          <TabsList className="w-max flex-nowrap">
            {TAB_DEFS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value}>
                <Icon className="size-3.5" strokeWidth={1.5} />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {pane(
          'thresholds',
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
                    <span className="text-sm font-medium">{check.title}</span>
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
        )}

        {pane(
          'alerts',
          <div className="flex flex-col gap-4">
            <AlertChannelsPanel
              alerts={alerts}
              setAlerts={setAlerts}
              setChannelMinSeverity={setChannelMinSeverity}
              onEnableBrowser={(checked) => void handleEnableBrowser(checked)}
              onTestBrowser={handleTestBrowser}
              onTestHealthchecks={() => void handleTestHealthchecks()}
              onTestWebhook={() => void handleTestWebhook()}
            />

            <Separator />

            <ServerChannelConfigPanel />

            <Separator />

            <DigestSettingsPanel />

            <Separator />

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="flex flex-col">
                <Label className="text-sm font-medium">Minimum severity</Label>
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
        )}

        {pane(
          'active',
          <div className="space-y-6">
            <AlertStateCard />
            <ActiveAlertsPanel />
          </div>
        )}

        {pane('history', <RecentAlertsCard />)}

        {pane('routing', <AlertRoutingPanel />)}

        {pane('webhooks', <WebhookSubscriptionsPanel />)}

        {pane('maintenance', <MaintenanceWindowsPanel />)}

        {pane('quiet-hours', <QuietHoursPanel />)}

        {pane('suggested', <AlertSuggestionsPanel />)}

        {pane('custom-rules', <RuleBuilderPanel />)}
      </Tabs>

      {footer(handleSave)}
    </>
  )
}
