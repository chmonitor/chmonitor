import {
  getServerAlertConfig,
  getServerChannelSettings,
  getServerEmailConfig,
  getServerHysteresisConfig,
  getServerNtfyConfig,
  getServerOpsgenieConfig,
  getServerPushoverConfig,
  getServerTelegramConfig,
  getServerTwilioConfig,
} from './server-alert-config'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

const ENV_KEYS = [
  'HEALTH_ALERT_ENABLED',
  'HEALTH_ALERT_WEBHOOK_URL',
  'HEALTH_ALERT_MIN_SEVERITY',
] as const

const EMAIL_ENV_KEYS = [
  'HEALTH_ALERT_EMAIL_ENABLED',
  'HEALTH_ALERT_EMAIL_TO',
  'HEALTH_ALERT_EMAIL_FROM',
  'HEALTH_ALERT_EMAIL_PROVIDER_URL',
] as const

describe('getServerAlertConfig', () => {
  let saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    // Save current values so we can restore them after each test
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    // Restore original env state
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
    saved = {}
  })

  it('returns defaults when no env vars are set', () => {
    const config = getServerAlertConfig()

    expect(config.webhookEnabled).toBe(false)
    expect(config.webhookUrl).toBe('')
    // Invalid/missing env defaults to 'warning' in getServerAlertConfig
    expect(config.minSeverity).toBe('warning')
    // Server-side always overrides browserNotificationsEnabled to false
    expect(config.browserNotificationsEnabled).toBe(false)
  })

  it('sets webhookEnabled=true when HEALTH_ALERT_ENABLED is "true"', () => {
    process.env.HEALTH_ALERT_ENABLED = 'true'

    const config = getServerAlertConfig()

    expect(config.webhookEnabled).toBe(true)
  })

  it('keeps webhookEnabled=false when HEALTH_ALERT_ENABLED is "false"', () => {
    process.env.HEALTH_ALERT_ENABLED = 'false'

    const config = getServerAlertConfig()

    expect(config.webhookEnabled).toBe(false)
  })

  it('keeps webhookEnabled=false when HEALTH_ALERT_ENABLED is an arbitrary string', () => {
    process.env.HEALTH_ALERT_ENABLED = '1'

    const config = getServerAlertConfig()

    expect(config.webhookEnabled).toBe(false)
  })

  it('trims leading and trailing whitespace from webhook URL', () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = '  https://hooks.slack.com/test  '

    const config = getServerAlertConfig()

    expect(config.webhookUrl).toBe('https://hooks.slack.com/test')
  })

  it('sets webhookUrl to empty string when env var is an empty string', () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = ''

    const config = getServerAlertConfig()

    expect(config.webhookUrl).toBe('')
  })

  it('sets webhookUrl to empty string when env var is only whitespace', () => {
    process.env.HEALTH_ALERT_WEBHOOK_URL = '   '

    const config = getServerAlertConfig()

    expect(config.webhookUrl).toBe('')
  })

  it('parses minSeverity "critical" correctly', () => {
    process.env.HEALTH_ALERT_MIN_SEVERITY = 'critical'

    const config = getServerAlertConfig()

    expect(config.minSeverity).toBe('critical')
  })

  it('parses minSeverity "warning" correctly', () => {
    process.env.HEALTH_ALERT_MIN_SEVERITY = 'warning'

    const config = getServerAlertConfig()

    expect(config.minSeverity).toBe('warning')
  })

  it('falls back to "warning" for an invalid minSeverity value', () => {
    process.env.HEALTH_ALERT_MIN_SEVERITY = 'info'

    const config = getServerAlertConfig()

    expect(config.minSeverity).toBe('warning')
  })

  it('falls back to "warning" for an empty minSeverity env var', () => {
    process.env.HEALTH_ALERT_MIN_SEVERITY = ''

    const config = getServerAlertConfig()

    expect(config.minSeverity).toBe('warning')
  })

  it('always returns browserNotificationsEnabled=false regardless of any default', () => {
    // No env vars set — server-side must override regardless of DEFAULT_ALERT_SETTINGS
    const config = getServerAlertConfig()

    expect(config.browserNotificationsEnabled).toBe(false)
  })

  it('returns a complete AlertSettings shape with all required fields', () => {
    process.env.HEALTH_ALERT_ENABLED = 'true'
    process.env.HEALTH_ALERT_WEBHOOK_URL = 'https://example.com/hook'
    process.env.HEALTH_ALERT_MIN_SEVERITY = 'critical'

    const config = getServerAlertConfig()

    expect(config).toEqual({
      webhookEnabled: true,
      webhookUrl: 'https://example.com/hook',
      healthchecksUrl: '',
      minSeverity: 'critical',
      browserNotificationsEnabled: false,
    })
  })
})

const CHANNEL_ENV_KEYS = [
  'HEALTH_ALERT_WEBHOOK_ENABLED',
  'HEALTH_ALERT_WEBHOOK_MIN_SEVERITY',
  'HEALTH_ALERT_PAGERDUTY_ENABLED',
  'HEALTH_ALERT_PAGERDUTY_MIN_SEVERITY',
  'HEALTH_ALERT_TELEGRAM_MIN_SEVERITY',
] as const

describe('getServerChannelSettings (#2661)', () => {
  let saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of CHANNEL_ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of CHANNEL_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    saved = {}
  })

  it('returns an empty map when no per-channel env vars are set', () => {
    expect(getServerChannelSettings()).toEqual({})
  })

  it('parses per-channel enabled + minSeverity, ignoring junk', () => {
    process.env.HEALTH_ALERT_WEBHOOK_ENABLED = 'false'
    process.env.HEALTH_ALERT_PAGERDUTY_MIN_SEVERITY = 'warning'
    process.env.HEALTH_ALERT_TELEGRAM_MIN_SEVERITY = 'nonsense'

    expect(getServerChannelSettings()).toEqual({
      webhook: { enabled: false },
      pagerduty: { minSeverity: 'warning' },
    })
  })

  it('combines both fields for one channel', () => {
    process.env.HEALTH_ALERT_WEBHOOK_ENABLED = 'true'
    process.env.HEALTH_ALERT_WEBHOOK_MIN_SEVERITY = 'critical'

    expect(getServerChannelSettings()).toEqual({
      webhook: { enabled: true, minSeverity: 'critical' },
    })
  })
})

const OPSGENIE_ENV_KEYS = [
  'HEALTH_ALERT_OPSGENIE_API_KEY',
  'HEALTH_ALERT_OPSGENIE_REGION',
] as const

describe('getServerOpsgenieConfig', () => {
  let saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of OPSGENIE_ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of OPSGENIE_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
    saved = {}
  })

  it('returns null when no API key is configured (fail-open)', () => {
    expect(getServerOpsgenieConfig()).toBeNull()
  })

  it('returns null when the API key is only whitespace', () => {
    process.env.HEALTH_ALERT_OPSGENIE_API_KEY = '   '
    expect(getServerOpsgenieConfig()).toBeNull()
  })

  it('trims the API key and defaults region to "us"', () => {
    process.env.HEALTH_ALERT_OPSGENIE_API_KEY = '  my-key  '
    expect(getServerOpsgenieConfig()).toEqual({
      apiKey: 'my-key',
      region: 'us',
    })
  })

  it('reads region "eu" case-insensitively', () => {
    process.env.HEALTH_ALERT_OPSGENIE_API_KEY = 'my-key'
    process.env.HEALTH_ALERT_OPSGENIE_REGION = 'EU'
    expect(getServerOpsgenieConfig()?.region).toBe('eu')
  })

  it('falls back to "us" for an invalid region value', () => {
    process.env.HEALTH_ALERT_OPSGENIE_API_KEY = 'my-key'
    process.env.HEALTH_ALERT_OPSGENIE_REGION = 'apac'
    expect(getServerOpsgenieConfig()?.region).toBe('us')
  })
})

describe('getServerEmailConfig', () => {
  let saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of EMAIL_ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of EMAIL_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
    saved = {}
  })

  it('returns null when no env vars are set (fail-open)', () => {
    expect(getServerEmailConfig()).toBeNull()
  })

  it('returns null when HEALTH_ALERT_EMAIL_ENABLED is not exactly "true"', () => {
    process.env.HEALTH_ALERT_EMAIL_ENABLED = '1'
    process.env.HEALTH_ALERT_EMAIL_TO = 'ops@example.com'
    process.env.HEALTH_ALERT_EMAIL_FROM = 'alerts@example.com'
    process.env.HEALTH_ALERT_EMAIL_PROVIDER_URL = 'mailgun://key@example.com'

    expect(getServerEmailConfig()).toBeNull()
  })

  it('returns null when enabled but the provider URL is missing', () => {
    process.env.HEALTH_ALERT_EMAIL_ENABLED = 'true'
    process.env.HEALTH_ALERT_EMAIL_TO = 'ops@example.com'
    process.env.HEALTH_ALERT_EMAIL_FROM = 'alerts@example.com'

    expect(getServerEmailConfig()).toBeNull()
  })

  it('returns null when the provider URL scheme is unrecognized', () => {
    process.env.HEALTH_ALERT_EMAIL_ENABLED = 'true'
    process.env.HEALTH_ALERT_EMAIL_TO = 'ops@example.com'
    process.env.HEALTH_ALERT_EMAIL_FROM = 'alerts@example.com'
    process.env.HEALTH_ALERT_EMAIL_PROVIDER_URL = 'https://example.com/hook'

    expect(getServerEmailConfig()).toBeNull()
  })

  it('returns null when enabled but "from" is missing', () => {
    process.env.HEALTH_ALERT_EMAIL_ENABLED = 'true'
    process.env.HEALTH_ALERT_EMAIL_TO = 'ops@example.com'
    process.env.HEALTH_ALERT_EMAIL_PROVIDER_URL = 'sendgrid://key'

    expect(getServerEmailConfig()).toBeNull()
  })

  it('returns null when enabled but there are no recipients', () => {
    process.env.HEALTH_ALERT_EMAIL_ENABLED = 'true'
    process.env.HEALTH_ALERT_EMAIL_FROM = 'alerts@example.com'
    process.env.HEALTH_ALERT_EMAIL_PROVIDER_URL = 'sendgrid://key'

    expect(getServerEmailConfig()).toBeNull()
  })

  it('returns null when recipients are only whitespace/commas', () => {
    process.env.HEALTH_ALERT_EMAIL_ENABLED = 'true'
    process.env.HEALTH_ALERT_EMAIL_TO = ' , , '
    process.env.HEALTH_ALERT_EMAIL_FROM = 'alerts@example.com'
    process.env.HEALTH_ALERT_EMAIL_PROVIDER_URL = 'sendgrid://key'

    expect(getServerEmailConfig()).toBeNull()
  })

  it('parses a fully configured mailgun setup', () => {
    process.env.HEALTH_ALERT_EMAIL_ENABLED = 'true'
    process.env.HEALTH_ALERT_EMAIL_TO = 'ops@example.com, oncall@example.com'
    process.env.HEALTH_ALERT_EMAIL_FROM = 'alerts@example.com'
    process.env.HEALTH_ALERT_EMAIL_PROVIDER_URL = 'mailgun://key@mg.example.com'

    expect(getServerEmailConfig()).toEqual({
      provider: 'mailgun',
      from: 'alerts@example.com',
      to: ['ops@example.com', 'oncall@example.com'],
    })
  })

  it('parses a fully configured sendgrid setup', () => {
    process.env.HEALTH_ALERT_EMAIL_ENABLED = 'true'
    process.env.HEALTH_ALERT_EMAIL_TO = 'ops@example.com'
    process.env.HEALTH_ALERT_EMAIL_FROM = 'alerts@example.com'
    process.env.HEALTH_ALERT_EMAIL_PROVIDER_URL = 'sendgrid://key'

    expect(getServerEmailConfig()).toEqual({
      provider: 'sendgrid',
      from: 'alerts@example.com',
      to: ['ops@example.com'],
    })
  })

  it('parses a fully configured smtp(s) setup', () => {
    process.env.HEALTH_ALERT_EMAIL_ENABLED = 'true'
    process.env.HEALTH_ALERT_EMAIL_TO = 'ops@example.com'
    process.env.HEALTH_ALERT_EMAIL_FROM = 'alerts@example.com'
    process.env.HEALTH_ALERT_EMAIL_PROVIDER_URL =
      'smtps://user:pass@smtp.example.com:465'

    expect(getServerEmailConfig()).toEqual({
      provider: 'smtp',
      from: 'alerts@example.com',
      to: ['ops@example.com'],
    })
  })

  it('trims whitespace around recipients and from address', () => {
    process.env.HEALTH_ALERT_EMAIL_ENABLED = 'true'
    process.env.HEALTH_ALERT_EMAIL_TO =
      '  ops@example.com  ,  oncall@example.com  '
    process.env.HEALTH_ALERT_EMAIL_FROM = '  alerts@example.com  '
    process.env.HEALTH_ALERT_EMAIL_PROVIDER_URL = 'sendgrid://key'

    expect(getServerEmailConfig()).toEqual({
      provider: 'sendgrid',
      from: 'alerts@example.com',
      to: ['ops@example.com', 'oncall@example.com'],
    })
  })

  it('does not change getServerAlertConfig behaviour when email env vars are set', () => {
    process.env.HEALTH_ALERT_EMAIL_ENABLED = 'true'
    process.env.HEALTH_ALERT_EMAIL_TO = 'ops@example.com'
    process.env.HEALTH_ALERT_EMAIL_FROM = 'alerts@example.com'
    process.env.HEALTH_ALERT_EMAIL_PROVIDER_URL = 'sendgrid://key'

    const config = getServerAlertConfig()

    expect(config).toEqual({
      webhookEnabled: false,
      webhookUrl: '',
      healthchecksUrl: '',
      minSeverity: 'warning',
      browserNotificationsEnabled: false,
    })
  })
})

const TELEGRAM_ENV_KEYS = [
  'HEALTH_ALERT_TELEGRAM_BOT_TOKEN',
  'HEALTH_ALERT_TELEGRAM_CHAT_ID',
] as const

describe('getServerTelegramConfig', () => {
  const original: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of TELEGRAM_ENV_KEYS) {
      original[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of TELEGRAM_ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
  })

  it('returns null when neither var is set', () => {
    expect(getServerTelegramConfig()).toBeNull()
  })

  it('returns null when only the bot token is set', () => {
    process.env.HEALTH_ALERT_TELEGRAM_BOT_TOKEN = '123:ABC'
    expect(getServerTelegramConfig()).toBeNull()
  })

  it('returns null when only the chat id is set', () => {
    process.env.HEALTH_ALERT_TELEGRAM_CHAT_ID = '-100'
    expect(getServerTelegramConfig()).toBeNull()
  })

  it('returns null when a var is whitespace-only', () => {
    process.env.HEALTH_ALERT_TELEGRAM_BOT_TOKEN = '   '
    process.env.HEALTH_ALERT_TELEGRAM_CHAT_ID = '-100'
    expect(getServerTelegramConfig()).toBeNull()
  })

  it('trims and returns both values when set', () => {
    process.env.HEALTH_ALERT_TELEGRAM_BOT_TOKEN = '  123:ABC  '
    process.env.HEALTH_ALERT_TELEGRAM_CHAT_ID = '  -100  '
    expect(getServerTelegramConfig()).toEqual({
      botToken: '123:ABC',
      chatId: '-100',
    })
  })
})

const NTFY_ENV_KEYS = [
  'HEALTH_ALERT_NTFY_URL',
  'HEALTH_ALERT_NTFY_TOKEN',
] as const

describe('getServerNtfyConfig', () => {
  const original: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of NTFY_ENV_KEYS) {
      original[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of NTFY_ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
  })

  it('returns null when the URL is not set', () => {
    expect(getServerNtfyConfig()).toBeNull()
  })

  it('returns null when the URL is whitespace-only', () => {
    process.env.HEALTH_ALERT_NTFY_URL = '   '
    expect(getServerNtfyConfig()).toBeNull()
  })

  it('returns the URL alone when no token is set', () => {
    process.env.HEALTH_ALERT_NTFY_URL = '  https://ntfy.sh/my-topic  '
    expect(getServerNtfyConfig()).toEqual({ url: 'https://ntfy.sh/my-topic' })
  })

  it('trims and returns URL + token when both set', () => {
    process.env.HEALTH_ALERT_NTFY_URL = '  https://ntfy.sh/my-topic  '
    process.env.HEALTH_ALERT_NTFY_TOKEN = '  tk_secret  '
    expect(getServerNtfyConfig()).toEqual({
      url: 'https://ntfy.sh/my-topic',
      token: 'tk_secret',
    })
  })
})

const TWILIO_ENV_KEYS = [
  'HEALTH_ALERT_TWILIO_ACCOUNT_SID',
  'HEALTH_ALERT_TWILIO_AUTH_TOKEN',
  'HEALTH_ALERT_TWILIO_FROM',
  'HEALTH_ALERT_TWILIO_TO',
  'HEALTH_ALERT_TWILIO_MIN_SEVERITY',
] as const

describe('getServerTwilioConfig', () => {
  const original: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of TWILIO_ENV_KEYS) {
      original[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of TWILIO_ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
  })

  it('returns null when nothing is set', () => {
    expect(getServerTwilioConfig()).toBeNull()
  })

  function setAllExcept(missing: (typeof TWILIO_ENV_KEYS)[number]) {
    if (missing !== 'HEALTH_ALERT_TWILIO_ACCOUNT_SID') {
      process.env.HEALTH_ALERT_TWILIO_ACCOUNT_SID = 'ACtest1234'
    }
    if (missing !== 'HEALTH_ALERT_TWILIO_AUTH_TOKEN') {
      process.env.HEALTH_ALERT_TWILIO_AUTH_TOKEN = 'secret-token'
    }
    if (missing !== 'HEALTH_ALERT_TWILIO_FROM') {
      process.env.HEALTH_ALERT_TWILIO_FROM = '+15557654321'
    }
    if (missing !== 'HEALTH_ALERT_TWILIO_TO') {
      process.env.HEALTH_ALERT_TWILIO_TO = '+15551234567'
    }
  }

  it('returns null when the account SID is missing', () => {
    setAllExcept('HEALTH_ALERT_TWILIO_ACCOUNT_SID')
    expect(getServerTwilioConfig()).toBeNull()
  })

  it('returns null when the auth token is missing', () => {
    setAllExcept('HEALTH_ALERT_TWILIO_AUTH_TOKEN')
    expect(getServerTwilioConfig()).toBeNull()
  })

  it('returns null when the from number is missing', () => {
    setAllExcept('HEALTH_ALERT_TWILIO_FROM')
    expect(getServerTwilioConfig()).toBeNull()
  })

  it('returns null when no recipient is configured', () => {
    setAllExcept('HEALTH_ALERT_TWILIO_TO')
    expect(getServerTwilioConfig()).toBeNull()
  })

  it('returns null when HEALTH_ALERT_TWILIO_TO is blank/comma-only', () => {
    setAllExcept('HEALTH_ALERT_TWILIO_TO')
    process.env.HEALTH_ALERT_TWILIO_TO = ' , , '
    expect(getServerTwilioConfig()).toBeNull()
  })

  it('defaults minSeverity to critical when configured and unset', () => {
    setAllExcept('HEALTH_ALERT_TWILIO_MIN_SEVERITY')
    expect(getServerTwilioConfig()).toEqual({
      accountSid: 'ACtest1234',
      authToken: 'secret-token',
      from: '+15557654321',
      to: ['+15551234567'],
      minSeverity: 'critical',
    })
  })

  it('splits and trims a comma-separated recipient list', () => {
    setAllExcept('HEALTH_ALERT_TWILIO_MIN_SEVERITY')
    process.env.HEALTH_ALERT_TWILIO_TO = ' +15551234567 , +15559876543 ,'
    expect(getServerTwilioConfig()?.to).toEqual([
      '+15551234567',
      '+15559876543',
    ])
  })

  it('honours HEALTH_ALERT_TWILIO_MIN_SEVERITY=warning', () => {
    setAllExcept('HEALTH_ALERT_TWILIO_MIN_SEVERITY')
    process.env.HEALTH_ALERT_TWILIO_MIN_SEVERITY = 'warning'
    expect(getServerTwilioConfig()?.minSeverity).toBe('warning')
  })

  it('falls back to critical for an unrecognized min-severity value', () => {
    setAllExcept('HEALTH_ALERT_TWILIO_MIN_SEVERITY')
    process.env.HEALTH_ALERT_TWILIO_MIN_SEVERITY = 'bogus'
    expect(getServerTwilioConfig()?.minSeverity).toBe('critical')
  })
})

const PUSHOVER_ENV_KEYS = [
  'HEALTH_ALERT_PUSHOVER_TOKEN',
  'HEALTH_ALERT_PUSHOVER_USER',
] as const

describe('getServerPushoverConfig', () => {
  const original: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of PUSHOVER_ENV_KEYS) {
      original[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of PUSHOVER_ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
  })

  it('returns null when neither var is set', () => {
    expect(getServerPushoverConfig()).toBeNull()
  })

  it('returns null when only the token is set', () => {
    process.env.HEALTH_ALERT_PUSHOVER_TOKEN = 'app_tok'
    expect(getServerPushoverConfig()).toBeNull()
  })

  it('returns null when only the user key is set', () => {
    process.env.HEALTH_ALERT_PUSHOVER_USER = 'usr_key'
    expect(getServerPushoverConfig()).toBeNull()
  })

  it('returns null when a var is whitespace-only', () => {
    process.env.HEALTH_ALERT_PUSHOVER_TOKEN = '   '
    process.env.HEALTH_ALERT_PUSHOVER_USER = 'usr_key'
    expect(getServerPushoverConfig()).toBeNull()
  })

  it('trims and returns both values when set', () => {
    process.env.HEALTH_ALERT_PUSHOVER_TOKEN = '  app_tok  '
    process.env.HEALTH_ALERT_PUSHOVER_USER = '  usr_key  '
    expect(getServerPushoverConfig()).toEqual({
      token: 'app_tok',
      user: 'usr_key',
    })
  })
})

describe('getServerHysteresisConfig', () => {
  const HYST_KEYS = [
    'HEALTH_HYSTERESIS_BREACHES',
    'HEALTH_HYSTERESIS_CLEARS',
    'HEALTH_HYSTERESIS_DISK_USAGE_BREACHES',
    'HEALTH_HYSTERESIS_DISK_USAGE_CLEARS',
  ] as const
  let saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of HYST_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })
  afterEach(() => {
    for (const key of HYST_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    saved = {}
  })

  it('falls back to the product default (fire=1, clear=2) when unset', () => {
    const { defaults, byRule } = getServerHysteresisConfig(['disk-usage'])
    expect(defaults).toEqual({
      minConsecutiveBreaches: 1,
      minConsecutiveClears: 2,
    })
    expect(byRule['disk-usage']).toEqual(defaults)
  })

  it('honors global overrides', () => {
    process.env.HEALTH_HYSTERESIS_BREACHES = '3'
    process.env.HEALTH_HYSTERESIS_CLEARS = '4'
    const { defaults } = getServerHysteresisConfig([])
    expect(defaults).toEqual({
      minConsecutiveBreaches: 3,
      minConsecutiveClears: 4,
    })
  })

  it('per-rule override wins over global and default', () => {
    process.env.HEALTH_HYSTERESIS_CLEARS = '5'
    process.env.HEALTH_HYSTERESIS_DISK_USAGE_BREACHES = '2'
    const { byRule } = getServerHysteresisConfig(['disk-usage'])
    expect(byRule['disk-usage']).toEqual({
      minConsecutiveBreaches: 2, // per-rule
      minConsecutiveClears: 5, // inherits global
    })
  })

  it('ignores non-numeric and < 1 values', () => {
    process.env.HEALTH_HYSTERESIS_BREACHES = 'nope'
    process.env.HEALTH_HYSTERESIS_CLEARS = '0'
    const { defaults } = getServerHysteresisConfig([])
    expect(defaults).toEqual({
      minConsecutiveBreaches: 1,
      minConsecutiveClears: 2,
    })
  })
})
