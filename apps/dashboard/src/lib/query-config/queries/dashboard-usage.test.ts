import { describe, expect, it } from 'bun:test'
import { dashboardUsageConfigs } from '@/lib/query-config/queries/dashboard-usage'
import { queriesItems } from '@/menu/queries'

/**
 * The attribution record names every signed-in user of the deployment, so the
 * page is admin-only, like Page Views — not open to anyone who can see queries.
 */
describe('Dashboard Usage permission', () => {
  it('gates every config behind operations', () => {
    expect(dashboardUsageConfigs.length).toBeGreaterThan(0)
    for (const config of dashboardUsageConfigs) {
      expect(config.permission).toEqual({ feature: 'operations' })
    }
  })

  it('gates the menu entry behind operations', () => {
    const item = queriesItems
      .flatMap((group) => group.items ?? [])
      .find((i) => i.href === '/dashboard-usage')
    expect(item?.permission).toEqual({ feature: 'operations' })
  })
})
