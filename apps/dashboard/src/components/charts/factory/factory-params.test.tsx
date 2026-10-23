/**
 * Area and bar factory charts must send `params` with the chart request. The
 * one-user Dashboard Usage page narrows its charts with
 * `params={{ dashboard_user }}`; a factory that drops it shows every user's
 * data under one user's name.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { afterAll, describe, expect, mock, test } from 'bun:test'
import { renderToString } from 'react-dom/server'

function render(node: React.ReactNode): void {
  renderToString(
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
  )
}

const calls: Array<Record<string, unknown>> = []

const realSwr = { ...(await import('@/lib/swr')) }
mock.module('@/lib/swr', () => ({
  ...realSwr,
  useHostId: () => 0,
  useChartData: (args: Record<string, unknown>) => {
    calls.push(args)
    return {
      data: undefined,
      isLoading: true,
      error: undefined,
      mutate: () => {},
    }
  },
}))

// Restore the real module so this mock never leaks into other test files.
afterAll(() => {
  mock.module('@/lib/swr', () => ({ ...realSwr }))
})

describe('factory charts forward params', () => {
  test('createAreaChart sends params to useChartData', async () => {
    const { createAreaChart } = await import('./create-area-chart')
    const Chart = createAreaChart({
      chartName: 'area-params-test',
      index: 'bucket',
      categories: ['queries'],
    })
    calls.length = 0
    render(<Chart params={{ dashboard_user: 'jane' }} />)
    expect(calls.at(-1)?.params).toEqual({ dashboard_user: 'jane' })
  })

  test('createBarChart sends params to useChartData', async () => {
    const { createBarChart } = await import('./create-bar-chart')
    const Chart = createBarChart({
      chartName: 'bar-params-test',
      index: 'name',
      categories: ['queries'],
    })
    calls.length = 0
    render(<Chart params={{ dashboard_user: 'jane', dimension: 'source' }} />)
    expect(calls.at(-1)?.params).toEqual({
      dashboard_user: 'jane',
      dimension: 'source',
    })
  })
})
