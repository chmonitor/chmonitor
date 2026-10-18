/**
 * disk-time-to-full against a live server (opt-in, see live-clickhouse.ts).
 *
 * Writes synthetic free-space series for made-up disks into
 * system.asynchronous_metric_log and narrows the rule to one of them at a
 * time, so the real disks on the test host cannot move the result.
 */

import { builtinRule, LIVE_URL, liveClient, ruleValue } from './live-clickhouse'
import { describe, expect, test } from 'bun:test'

const PREFIX = "startsWith(metric, 'DiskAvailable_')"

describe.skipIf(!LIVE_URL)('disk-time-to-full (live)', () => {
  test('reads a falling disk, a flat disk and a thin series correctly', async () => {
    const client = liveClient()!
    const rule = builtinRule('disk-time-to-full')
    expect(rule.sql).toContain(PREFIX)
    const tag = `chmtest${Date.now()}`

    // `points` samples every 10 minutes over the last 6 hours, starting at
    // `start` bytes free and changing by `step` bytes per sample.
    const series = (
      disk: string,
      points: number,
      start: number,
      step: number
    ) =>
      client.command({
        query: `INSERT INTO system.asynchronous_metric_log (hostname, event_date, event_time, metric, value)
SELECT hostName(), toDate(t), t, 'DiskAvailable_${tag}_${disk}', ${start} + number * ${step}
FROM (SELECT number, now() - INTERVAL 6 HOUR + toIntervalSecond(number * 600 + 60) AS t FROM numbers(${points}))`,
      })
    const valueFor = (disk: string) =>
      ruleValue(
        client,
        rule.sql!.replace(PREFIX, `metric = 'DiskAvailable_${tag}_${disk}'`),
        rule.valueKey
      )

    // Loses 1 GB per 10 min: 6 GB/h. Last sample is 65 GB free, so full in
    // 65/6 = 10.8h, i.e. 24h of the trend is 6*24/65 = 221.5% of free space.
    await series('falling', 36, 100e9, -1e9)
    await series('flat', 36, 100e9, 0)
    await series('thin', 10, 100e9, -1e9)

    const falling = await valueFor('falling')
    expect(falling).toBeCloseTo(221.5, 0)
    expect(rule.formatLabel!(falling)).toBe('full in ~11h at the current rate')
    expect(await valueFor('flat')).toBe(0)
    expect(await valueFor('thin')).toBeNull()

    await client.command({
      query: `ALTER TABLE system.asynchronous_metric_log DELETE WHERE startsWith(metric, 'DiskAvailable_${tag}')`,
    })
    await client.close()
  }, 20_000)
})
