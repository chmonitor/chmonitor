/**
 * #4044: on a host with no replicated table the replication summary chart
 * shows the neutral "Replication not used" state, never an empty "no data"
 * card that reads as healthy.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

let used: boolean | undefined
const realSwr = { ...(await import('@/lib/swr')) }
const realUsage = { ...(await import('@/lib/swr/use-replication-usage')) }

mock.module('@/lib/swr', () => ({
  ...realSwr,
  useHostId: () => 0,
  useChartData: () => ({
    data: [],
    isLoading: false,
    error: undefined,
    mutate: () => {},
    sql: '',
  }),
}))
mock.module('@/lib/swr/use-replication-usage', () => ({
  useReplicationUsed: () => used,
}))

afterAll(() => {
  mock.module('@/lib/swr', () => ({ ...realSwr }))
  mock.module('@/lib/swr/use-replication-usage', () => ({ ...realUsage }))
})

const { ChartReplicationSummaryTable } = await import(
  './replication-summary-table'
)

describe('ChartReplicationSummaryTable without replication', () => {
  test('shows the neutral not-used state', () => {
    used = false
    const html = renderToStaticMarkup(
      <ChartReplicationSummaryTable title="Summary" hostId={0} />
    )
    expect(html).toContain('Replication not used on this host')
  })

  test('keeps the normal empty state when replication is used', () => {
    used = true
    const html = renderToStaticMarkup(
      <ChartReplicationSummaryTable title="Summary" hostId={0} />
    )
    expect(html).not.toContain('Replication not used on this host')
  })

  test('keeps the normal surface while the probe is unknown', () => {
    used = undefined
    const html = renderToStaticMarkup(
      <ChartReplicationSummaryTable title="Summary" hostId={0} />
    )
    expect(html).not.toContain('Replication not used on this host')
  })
})
