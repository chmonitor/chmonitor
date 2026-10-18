import type { ChartQueryBuilder } from './types'

import { applyInterval, fillStep, nowOrToday } from './types'
import { EVENTS_TABLE } from '@/lib/app-tables'

export const pageViewCharts: Record<string, ChartQueryBuilder> = {
  'page-view': ({ interval = 'toStartOfDay', lastHours = 24 * 14 }) => {
    const eventTimeExpr = applyInterval(interval, 'event_time', 'event_time')
    return {
      query: `
    SELECT ${eventTimeExpr},
           count() AS page_views
    FROM ${EVENTS_TABLE}
    WHERE kind = 'PageView'
      AND event_time >= (now() - INTERVAL ${lastHours} HOUR)
    GROUP BY event_time
    ORDER BY event_time WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `,
      optional: true,
      tableCheck: EVENTS_TABLE,
    }
  },

  'top-pages': () => ({
    query: `
    SELECT data AS url, count() AS views
    FROM ${EVENTS_TABLE}
    WHERE kind = 'PageView'
    GROUP BY url
    ORDER BY views DESC
    LIMIT 10
  `,
    optional: true,
    tableCheck: EVENTS_TABLE,
  }),

  'human-vs-bot-pageviews': ({
    interval = 'toStartOfDay',
    lastHours = 24 * 14,
  }) => {
    const eventTimeExpr = applyInterval(interval, 'event_time', 'event_time')
    return {
      query: `
      SELECT ${eventTimeExpr},
             countIf(NOT JSONExtractBool(extra, 'isBot')) AS human_views,
             countIf(JSONExtractBool(extra, 'isBot')) AS bot_views
      FROM ${EVENTS_TABLE}
      WHERE kind = 'PageView'
        AND event_time >= (now() - INTERVAL ${lastHours} HOUR)
      GROUP BY event_time
      ORDER BY event_time WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
    `,
      optional: true,
      tableCheck: EVENTS_TABLE,
    }
  },

  'pageviews-by-device': () => ({
    query: `
    SELECT
      if(empty(JSONExtractString(extra, 'device')),
         'unknown',
         concat(JSONExtractString(extra, 'device.vendor'), ' ', JSONExtractString(extra, 'device.model'))
      ) AS device,
      count() AS views
    FROM ${EVENTS_TABLE}
    WHERE kind = 'PageView'
    GROUP BY device
    ORDER BY views DESC
  `,
    optional: true,
    tableCheck: EVENTS_TABLE,
  }),

  'pageviews-by-country': () => ({
    query: `
    SELECT JSONExtractString(extra, 'country') AS country, count() AS views
    FROM ${EVENTS_TABLE}
    WHERE kind = 'PageView'
      AND JSONExtractString(extra, 'country') != ''
    GROUP BY country
    ORDER BY views DESC
    LIMIT 10
  `,
    optional: true,
    tableCheck: EVENTS_TABLE,
  }),
}
