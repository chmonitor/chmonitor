import type { ClickHouseConfig } from '@chm/clickhouse-client'

import { filterToDemoHosts } from '@/lib/cloud/demo-hosts'

// Resolves ClickHouseConfig[] from the comma-separated env lists, mirroring
// @chm/clickhouse-client getClickHouseConfigs() but sourcing from the passed bindings.
export function splitByComma(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function getClickHouseConfigsFromEnv(
  bindings: Record<string, string | undefined>
): ClickHouseConfig[] {
  const hosts = splitByComma(bindings.CLICKHOUSE_HOST)
  const users = splitByComma(bindings.CLICKHOUSE_USER)
  const passwords = splitByComma(bindings.CLICKHOUSE_PASSWORD)
  const customLabels = splitByComma(bindings.CLICKHOUSE_NAME)

  const configs = hosts.map((host, index) => {
    // A single credential pair serves many hosts; otherwise index by position.
    let user: string
    let password: string
    if (users.length === 1 && passwords.length === 1) {
      user = users[0]
      password = passwords[0]
    } else {
      user = users[index] || 'default'
      password = passwords[index] || ''
    }
    return { id: index, host, user, password, customName: customLabels[index] }
  })

  // In cloud mode, restrict to the public-demo allowlist (CHM_CLOUD_DEMO_HOSTS)
  // so env-host surfaces (live status, health, notifications) reflect only the
  // demo host. `id` is the original index, so per-host routing stays correct.
  // No-op in self-hosted mode or when the var is unset.
  return filterToDemoHosts(configs, bindings, {
    name: (c) => c.customName,
    host: (c) => c.host,
  })
}
