/**
 * ClickHouse Configuration
 * Parses environment variables and creates ClickHouse configurations
 */

import type { ClickHouseEnv } from './env-schema'
import type { ClickHouseConfig } from './types'

import { _resetEnvCache, validateClickHouseEnv } from './env-schema'
import { debug, error, isDebugEnabled } from '@chm/logger'

/**
 * Re-export env cache reset so tests can reset the SAME env-schema instance
 * that this module's getClickHouseConfigs() uses internally. Resetting it also
 * invalidates the parsed-config memo below, because validateClickHouseEnv()
 * then returns a fresh env object whose reference no longer matches _cachedEnv.
 */
export { _resetEnvCache }

/**
 * Memoized parsed configs, keyed by the env object reference returned by
 * validateClickHouseEnv(). Env vars don't change at runtime, so parsing once
 * avoids re-splitting/re-building configs on every getClickHouseConfigs() call.
 * When _resetEnvCache() runs, validateClickHouseEnv() returns a new reference on
 * its next call, so `_cachedEnv !== env` and we re-parse automatically.
 */
let _cachedEnv: ClickHouseEnv | null = null
let _cachedConfigs: ClickHouseConfig[] | null = null

/**
 * Redacts username and password credentials from a ClickHouse host URL string
 */
export function redactHostCredentials(urlStr: string): string {
  // Fast-path: no '@' means no credentials to redact.
  if (!urlStr.includes('@')) {
    return urlStr
  }
  try {
    const url = new URL(urlStr)
    // Only trust the parse result for http/https — other inputs (e.g.
    // "admin:secret@host") are silently parsed with "admin:" as the scheme
    // and no username/password, so we fall through to the regex path.
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (url.username) url.username = '***'
      if (url.password) url.password = '***'
      return url.toString()
    }
  } catch {
    // URL constructor threw — fall through to regex below.
  }
  // Fallback for URLs without a recognized protocol (e.g. "admin:secret@host:8123").
  // Handles user:pass@, :pass@ (password-only), and user@ (username-only).
  return urlStr.replace(
    /(?:(https?:\/\/))?([^:@]*)(?::([^@]*))?@/,
    (_, proto, user, pass) => {
      const redactedUser = user ? '***' : ''
      const redactedPass = pass !== undefined ? ':***' : ''
      return `${proto ?? ''}${redactedUser}${redactedPass}@`
    }
  )
}

/**
 * Retrieve a single ClickHouseConfig by hostId, throwing if the id is out of
 * range.  Centralises the "lookup + validate" logic so callers like getClient
 * and fetchExplainAsText don't duplicate it.
 */
export function getAndValidateClientConfig(hostId: number): ClickHouseConfig {
  const configs = getClickHouseConfigs()
  if (configs.length === 0) {
    throw new Error('No ClickHouse hosts configured')
  }
  const config = configs[hostId]
  if (!config) {
    throw new Error(
      `Invalid hostId: ${hostId}. Available hosts: 0-${configs.length - 1}`
    )
  }
  return config
}

export const getClickHouseHosts = () => {
  const { CLICKHOUSE_HOST } = validateClickHouseEnv()
  return CLICKHOUSE_HOST.split(',')
    .map((host) => host.trim())
    .filter(Boolean)
}

function splitByComma(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export const getClickHouseConfigs = (): ClickHouseConfig[] => {
  const env = validateClickHouseEnv()
  if (_cachedConfigs && _cachedEnv === env) return _cachedConfigs

  const hostEnv = env.CLICKHOUSE_HOST
  const userEnv = env.CLICKHOUSE_USER
  const passwordEnv = env.CLICKHOUSE_PASSWORD
  const customNameEnv = env.CLICKHOUSE_NAME || ''

  // Debug logging for environment variables
  if (!hostEnv) {
    error(
      '[ClickHouse Config] CRITICAL: CLICKHOUSE_HOST environment variable is not set!'
    )
    error(
      '[ClickHouse Config] Available env keys:',
      Object.keys(process.env).filter((k) => k.includes('CLICK'))
    )
  } else if (isDebugEnabled()) {
    // Only build the redacted host string when debug logging is active — the
    // per-host URL redaction is otherwise discarded work in production.
    const redactedHostEnv = splitByComma(hostEnv)
      .map(redactHostCredentials)
      .join(',')
    debug('[ClickHouse Config] CLICKHOUSE_HOST:', redactedHostEnv)
    debug('[ClickHouse Config] CLICKHOUSE_USER:', userEnv ? '***' : '(empty)')
    debug(
      '[ClickHouse Config] CLICKHOUSE_PASSWORD:',
      passwordEnv ? '***' : '(empty)'
    )
    debug('[ClickHouse Config] CLICKHOUSE_NAME:', customNameEnv || '(empty)')
  }

  const hosts = splitByComma(hostEnv)
  const users = splitByComma(userEnv)
  const passwords = splitByComma(passwordEnv)
  const customLabels = splitByComma(customNameEnv)

  debug('[ClickHouse Config] Parsed hosts count:', hosts.length)

  if (hosts.length === 0) {
    error(
      '[ClickHouse Config] No hosts configured! Please set CLICKHOUSE_HOST environment variable.'
    )
    error('[ClickHouse Config] Example: CLICKHOUSE_HOST=http://localhost:8123')
    return []
  }

  const configs = hosts.map((host, index) => {
    // User and password fallback to the first value,
    // supporting multiple hosts with the same user/password
    let user, password
    if (users.length === 1 && passwords.length === 1) {
      user = users[0]
      password = passwords[0]
    } else {
      user = users[index] || 'default'
      password = passwords[index] || ''
    }

    const config = {
      id: index,
      host,
      user,
      password,
      customName: customLabels[index],
    }

    if (isDebugEnabled()) {
      debug(`[ClickHouse Config] Host ${index}:`, {
        id: config.id,
        host: redactHostCredentials(config.host),
        user: config.user,
        hasPassword: !!config.password,
        customName: config.customName,
      })
    }

    return config
  })

  _cachedEnv = env
  _cachedConfigs = configs
  return configs
}
