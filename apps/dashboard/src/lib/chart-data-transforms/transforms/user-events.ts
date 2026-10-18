import type { UserEventCountsTransformed } from '../types'

export function transformUserEventCounts<T extends string = 'event_time'>(
  data: readonly Record<string, unknown>[],
  timeField: T = 'event_time' as T
): UserEventCountsTransformed<T> {
  const userSet = new Set<string>()
  const nestedData = data.reduce<Record<string, Record<string, number>>>(
    (acc, item) => {
      const event_time = String(item.event_time ?? '')
      const rawUser = String(item.user ?? '')
      // Display "(empty)" for empty/whitespace-only user names in charts
      const user = rawUser.trim() === '' ? '(empty)' : rawUser
      const count = Number(item.count ?? 0)

      userSet.add(user)

      if (acc[event_time] === undefined) {
        acc[event_time] = {}
      }

      acc[event_time][user] = (acc[event_time][user] ?? 0) + count
      return acc
    },
    {}
  )

  const users = Array.from(userSet).sort()

  const chartData = Object.entries(nestedData).map(([time, userCounts]) => {
    const entry: Record<string, number | string> = { [timeField]: time }
    Object.entries(userCounts).forEach(([user, count]) => {
      entry[user] = count
    })
    return entry as Record<T, string> & Record<string, number>
  })

  return {
    data: nestedData as Record<T, Record<string, number>>,
    users,
    chartData,
  }
}
