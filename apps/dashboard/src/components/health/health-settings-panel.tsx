'use client'

import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  CircleAlert,
  Cog,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'

import type { AlertChannelId } from '@/lib/health/alert-channel-settings'
import type { AdvancedSectionId } from './advanced-settings-panel'

import { ActiveAlertsPanel } from './active-alerts-panel'
import { AdvancedSettingsPanel } from './advanced-settings-panel'
import { AlertChannelsPanel } from './alert-channels-panel'
import { AlertStateCard } from './alert-state-card'
import { AlertTemplateDialog } from './alert-template-dialog'
import { HEALTH_CHECKS } from './health-checks'
import { RecentAlertsCard } from './recent-alerts-card'
import { ServerChannelConfigPanel } from './server-channel-config-panel'
import { ThresholdsPanel } from './thresholds-panel'
import { type ReactNode, useEffect, useState } from 'react'
import { SegmentedControl } from '@/components/settings/segmented-control'
import { Button } from '@/components/ui/button'
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
import { useNotificationPermission } from '@/lib/health/use-notification-permission'
import { describeError } from '@/lib/swr/fetch-error'

/**
 * The four tabs the page renders. The surface used to have ten, six of which
 * were single panels an operator visits once a quarter — those now live behind
 * cards in `Advanced`.
 */
export const HEALTH_SETTINGS_TABS = [
  'alerts',
  'thresholds',
  'activity',
  'advanced',
] as const

export type HealthSettingsTab = (typeof HEALTH_SETTINGS_TABS)[number]

/**
 * Legacy `?tab=` values (the pre-collapse ten) mapped to where their content
 * lives now. Deep links from the menu, docs and older bookmarks must keep
 * working — `advancedSection` additionally opens the right dialog.
 */
const LEGACY_TAB_MAP: Record<
  string,
  { tab: HealthSettingsTab; advancedSection?: AdvancedSectionId }
> = {
  thresholds: { tab: 'thresholds' },
  alerts: { tab: 'alerts' },
  active: { tab: 'activity' },
  history: { tab: 'activity' },
  activity: { tab: 'activity' },
  advanced: { tab: 'advanced' },
  routing: { tab: 'advanced', advancedSection: 'routing' },
  webhooks: { tab: 'advanced', advancedSection: 'webhooks' },
  maintenance: { tab: 'advanced', advancedSection: 'maintenance' },
  'quiet-hours': { tab: 'advanced', advancedSection: 'quiet-hours' },
  digest: { tab: 'advanced', advancedSection: 'digest' },
  suggested: { tab: 'advanced', advancedSection: 'suggested' },
  'custom-rules': { tab: 'advanced', advancedSection: 'custom-rules' },
}

/**
 * Tab strip definition — one place so every tab gets the same icon size and
 * spacing (`TabsTrigger` already supplies `items-center gap-1.5`; an extra
 * margin utility reads as misalignment).
 */
const TAB_DEFS: {
  value: HealthSettingsTab
  label: string
  icon: LucideIcon
}[] = [
  { value: 'alerts', label: 'Alerts', icon: Bell },
  { value: 'thresholds', label: 'Thresholds', icon: SlidersHorizontal },
  { value: 'activity', label: 'Activity', icon: CircleAlert },
  { value: 'advanced', label: 'Advanced', icon: Cog },
]

/** True for any tab id this page understands, including the legacy ones. */
export function isHealthSettingsTab(value: string | undefined): boolean {
  return value !== undefined && value in LEGACY_TAB_MAP
}

/** Resolve any (current or legacy) `?tab=` value to a tab + optional dialog. */
export function resolveHealthSettingsTab(value: string | undefined): {
  tab: HealthSettingsTab
  advancedSection?: AdvancedSectionId
} {
  return (value ? LEGACY_TAB_MAP[value] : undefined) ?? { tab: 'alerts' }
}

/**
 * Shared body of the health/alert settings surface — tabs, form state and
 * save logic. Rendered by the `/health-settings` and `/alert-settings` pages.
 */
export function HealthSettingsPanel({
  defaultTab,
  footer,
}: {
  /** Current or legacy `?tab=` value; resolved via {@link resolveHealthSettingsTab}. */
  defaultTab?: string
  /** Renders the action row; receives the validated save handler. */
  footer: (save: () => boolean) => ReactNode
}) {
  const resolved = resolveHealthSettingsTab(defaultTab)
  const [thresholds, setThresholdsState] = useState<ThresholdsMap>({})
  const [alerts, setAlerts] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS)
  const [templateOpen, setTemplateOpen] = useState(false)
  const permission = useNotificationPermission()

  useEffect(() => {
    setThresholdsState(loadThresholds())
    setAlerts(loadAlertSettings())
  }, [])

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
      if (permission.state === 'unsupported') {
        toast.error('Browser notifications are not supported in this browser')
        return
      }
      if (permission.state === 'denied') {
        toast.error(
          'Browser notifications are blocked. Enable them in your browser settings.'
        )
        return
      }
      if (permission.state === 'default') {
        try {
          const result = await permission.request()
          if (result !== 'granted') {
            toast.error('Browser notifications were not granted')
            // Still record the intent — the card shows "needs permission" and
            // flips to delivering as soon as the browser grants it.
            setAlerts((prev) => ({
              ...prev,
              browserNotificationsEnabled: true,
            }))
            return
          }
        } catch (err) {
          toast.error('Failed to request browser notification permission', {
            description: describeError(err),
          })
          return
        }
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
    // Gated on the live permission, not the stored preference — the two used to
    // disagree, so "Send test" could look available and deliver nothing.
    if (permission.state === 'unsupported') {
      toast.error('Browser notifications are not supported in this browser')
      return
    }
    if (!permission.canNotify) {
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
    <TabsContent value={value} className="mt-3">
      {children}
    </TabsContent>
  )

  return (
    <>
      <Tabs defaultValue={resolved.tab}>
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
          'alerts',
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3 shadow-sm">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">
                  Not sure where to start?
                </span>
                <span className="text-xs text-muted-foreground">
                  Apply a template to set the severity floor and thresholds in
                  one step — then customize anything.
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setTemplateOpen(true)}
              >
                <Sparkles className="size-3.5" strokeWidth={1.5} />
                Use a template
              </Button>
            </div>

            <AlertChannelsPanel
              alerts={alerts}
              setAlerts={setAlerts}
              setChannelMinSeverity={setChannelMinSeverity}
              onEnableBrowser={(checked) => void handleEnableBrowser(checked)}
              onTestBrowser={handleTestBrowser}
              onTestHealthchecks={() => void handleTestHealthchecks()}
              onTestWebhook={() => void handleTestWebhook()}
              permission={permission}
            />

            <Separator />

            <ServerChannelConfigPanel />

            <Separator />

            <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Minimum severity</span>
                <span className="text-xs text-muted-foreground">
                  The default floor — every channel above inherits it unless it
                  sets its own.
                </span>
              </div>
              <SegmentedControl
                value={alerts.minSeverity}
                onChange={(value) =>
                  setAlerts((prev) => ({
                    ...prev,
                    minSeverity: value as 'warning' | 'critical',
                  }))
                }
                ariaLabel="Minimum alert severity"
                options={[
                  {
                    value: 'warning',
                    label: 'Warning+',
                    description: 'Warning and critical',
                  },
                  {
                    value: 'critical',
                    label: 'Critical only',
                    description: 'Incidents only',
                  },
                ]}
              />
            </div>
          </div>
        )}

        {pane(
          'thresholds',
          <ThresholdsPanel
            thresholds={thresholds}
            setThresholds={setThresholdsState}
          />
        )}

        {pane(
          'activity',
          <div className="space-y-6">
            <AlertStateCard />
            <ActiveAlertsPanel />
            <RecentAlertsCard />
          </div>
        )}

        {pane(
          'advanced',
          <AdvancedSettingsPanel initialSection={resolved.advancedSection} />
        )}
      </Tabs>

      <AlertTemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        alerts={alerts}
        thresholds={thresholds}
        onApply={(next) => {
          setAlerts(next.alerts)
          setThresholdsState(next.thresholds)
          toast.success('Template applied — press Save to keep it')
        }}
      />

      {footer(handleSave)}
    </>
  )
}
