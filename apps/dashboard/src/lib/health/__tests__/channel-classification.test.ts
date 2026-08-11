import {
  type AlertSettings,
  DEFAULT_ALERT_SETTINGS,
} from '../alert-settings-storage'
import {
  isLocalChannelConfigured,
  isServerChannelConfigured,
  LOCAL_CHANNEL_IDS,
  partitionChannels,
} from '../channel-classification'
import { describe, expect, it } from 'bun:test'

const settings = (patch: Partial<AlertSettings> = {}): AlertSettings => ({
  ...DEFAULT_ALERT_SETTINGS,
  ...patch,
})

describe('isLocalChannelConfigured', () => {
  it('treats the browser channel as configured only while enabled', () => {
    expect(
      isLocalChannelConfigured(
        'browser',
        settings({ browserNotificationsEnabled: true })
      )
    ).toBe(true)
    expect(
      isLocalChannelConfigured(
        'browser',
        settings({ browserNotificationsEnabled: false })
      )
    ).toBe(false)
  })

  it('requires a non-blank URL for the URL-based channels', () => {
    expect(isLocalChannelConfigured('healthchecks', settings())).toBe(false)
    expect(
      isLocalChannelConfigured(
        'healthchecks',
        settings({ healthchecksUrl: '  ' })
      )
    ).toBe(false)
    expect(
      isLocalChannelConfigured(
        'healthchecks',
        settings({ healthchecksUrl: 'https://hc-ping.com/uuid' })
      )
    ).toBe(true)
    expect(
      isLocalChannelConfigured(
        'webhook',
        settings({ webhookUrl: 'https://hooks.slack.com/services/x' })
      )
    ).toBe(true)
  })

  it('ignores the enabled flag for the webhook URL (a saved URL stays a card)', () => {
    // The card owns the enable switch, so a configured-but-paused webhook must
    // keep its full card instead of dropping back to an "add" tile.
    expect(
      isLocalChannelConfigured(
        'webhook',
        settings({
          webhookUrl: 'https://example.com/hook',
          webhookEnabled: false,
        })
      )
    ).toBe(true)
  })
})

describe('isServerChannelConfigured', () => {
  it('counts a saved D1 row or a server env fallback', () => {
    expect(
      isServerChannelConfigured({ hasRow: false, envConfigured: false })
    ).toBe(false)
    expect(
      isServerChannelConfigured({ hasRow: true, envConfigured: false })
    ).toBe(true)
    expect(
      isServerChannelConfigured({ hasRow: false, envConfigured: true })
    ).toBe(true)
  })
})

describe('partitionChannels', () => {
  it('splits while preserving order', () => {
    const { configured, available } = partitionChannels(
      LOCAL_CHANNEL_IDS,
      (id) =>
        isLocalChannelConfigured(
          id,
          settings({
            browserNotificationsEnabled: false,
            webhookUrl: 'https://example.com/hook',
          })
        )
    )
    expect(configured).toEqual(['webhook'])
    expect(available).toEqual(['browser', 'healthchecks'])
  })

  it('returns everything as available when nothing is configured', () => {
    const { configured, available } = partitionChannels(
      LOCAL_CHANNEL_IDS,
      (id) =>
        isLocalChannelConfigured(
          id,
          settings({ browserNotificationsEnabled: false })
        )
    )
    expect(configured).toEqual([])
    expect(available).toEqual([...LOCAL_CHANNEL_IDS])
  })
})
