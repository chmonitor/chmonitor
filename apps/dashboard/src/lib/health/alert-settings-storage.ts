import {
  type ChannelSettingsMap,
  parseChannelSettings,
} from './alert-channel-settings'

const STORAGE_KEY = 'health-alert-settings'

export interface AlertSettings {
  /** Webhook URL (Slack/Discord-compatible). Empty when disabled. */
  webhookUrl: string
  webhookEnabled: boolean
  /**
   * healthchecks.io ping URL. When set, a success ("/") or failure ("/fail")
   * GET ping is fired on every alert/recovery. Self-hosted or cloud
   * healthchecks.io instances both accept a unique per-check ping URL.
   */
  healthchecksUrl: string
  browserNotificationsEnabled: boolean
  /** Severity threshold at which alerts fire: 'warning' = both warning+critical, 'critical' = only critical */
  minSeverity: 'warning' | 'critical'
  /**
   * Optional per-channel overrides (#2661). An absent map — or an absent
   * channel key — means every channel inherits the global {@link minSeverity}
   * and is enabled, i.e. exactly the pre-#2661 behaviour. See
   * {@link resolveChannelDelivery}.
   */
  channels?: ChannelSettingsMap
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  webhookUrl: '',
  webhookEnabled: false,
  healthchecksUrl: '',
  // Enabled by default so a fresh install surfaces critical alerts in-app
  // without any configuration. The browser Notification API is only invoked
  // when permission is already 'granted' (see fireBrowserNotification).
  browserNotificationsEnabled: true,
  minSeverity: 'critical',
}

export function loadAlertSettings(): AlertSettings {
  if (typeof window === 'undefined') return DEFAULT_ALERT_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_ALERT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<
      Record<keyof AlertSettings, unknown>
    >
    return {
      webhookUrl:
        typeof parsed.webhookUrl === 'string'
          ? parsed.webhookUrl
          : DEFAULT_ALERT_SETTINGS.webhookUrl,
      webhookEnabled:
        typeof parsed.webhookEnabled === 'boolean'
          ? parsed.webhookEnabled
          : DEFAULT_ALERT_SETTINGS.webhookEnabled,
      browserNotificationsEnabled:
        typeof parsed.browserNotificationsEnabled === 'boolean'
          ? parsed.browserNotificationsEnabled
          : DEFAULT_ALERT_SETTINGS.browserNotificationsEnabled,
      healthchecksUrl:
        typeof parsed.healthchecksUrl === 'string'
          ? parsed.healthchecksUrl
          : DEFAULT_ALERT_SETTINGS.healthchecksUrl,
      minSeverity:
        parsed.minSeverity === 'warning' || parsed.minSeverity === 'critical'
          ? parsed.minSeverity
          : DEFAULT_ALERT_SETTINGS.minSeverity,
      // Only include the key when there is something usable, so a fresh
      // install keeps the exact default shape (no empty `channels` object).
      ...(() => {
        const channels = parseChannelSettings(parsed.channels)
        return channels ? { channels } : {}
      })(),
    }
  } catch {
    return DEFAULT_ALERT_SETTINGS
  }
}

export function saveAlertSettings(settings: AlertSettings): boolean {
  if (typeof window === 'undefined') return false
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    window.dispatchEvent(new CustomEvent('health-alert-settings-changed'))
    return true
  } catch {
    return false
  }
}
