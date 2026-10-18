import type { DateRangeConfig, DateRangeOption } from './date-range-types'

/**
 * Standard range options with smart interval mapping
 *
 * Interval selection rationale:
 * - Short ranges (24h, 7d): hourly granularity for detail
 * - Long ranges (14d, 30d): daily granularity to avoid data overload
 */
export const RANGE_OPTIONS: Record<string, DateRangeOption> = {
  '1h': {
    label: '1h',
    value: '1h',
    lastHours: 1,
    interval: 'toStartOfMinute',
    description: 'Last 1 hour',
  },
  '6h': {
    label: '6h',
    value: '6h',
    lastHours: 6,
    interval: 'toStartOfFiveMinutes',
    description: 'Last 6 hours',
  },
  '24h': {
    label: '24h',
    value: '24h',
    lastHours: 24,
    interval: 'toStartOfHour',
    description: 'Last 24 hours',
  },
  '7d': {
    label: '7d',
    value: '7d',
    lastHours: 24 * 7,
    interval: 'toStartOfHour',
    description: 'Last 7 days',
  },
  '14d': {
    label: '14d',
    value: '14d',
    lastHours: 24 * 14,
    interval: 'toStartOfDay',
    description: 'Last 14 days',
  },
  '30d': {
    label: '30d',
    value: '30d',
    lastHours: 24 * 30,
    interval: 'toStartOfDay',
    description: 'Last 30 days',
  },
  '90d': {
    label: '90d',
    value: '90d',
    lastHours: 24 * 90,
    interval: 'toStartOfWeek',
    description: 'Last 90 days',
  },
  '6m': {
    label: '6M',
    value: '6m',
    lastHours: 24 * 180,
    interval: 'toStartOfWeek',
    description: 'Last 6 months',
  },
  '12m': {
    label: '12M',
    value: '12m',
    lastHours: 24 * 365,
    interval: 'toStartOfMonth',
    description: 'Last 12 months',
  },
  all: {
    label: 'All',
    value: 'all',
    lastHours: undefined,
    interval: 'toStartOfMonth',
    description: 'All available data',
  },
} as const

export const DATE_RANGE_PRESETS = {
  standard: {
    options: [
      RANGE_OPTIONS['24h'],
      RANGE_OPTIONS['7d'],
      RANGE_OPTIONS['14d'],
      RANGE_OPTIONS['30d'],
    ],
    defaultValue: '24h',
  },
  realtime: {
    options: [
      RANGE_OPTIONS['1h'],
      RANGE_OPTIONS['6h'],
      RANGE_OPTIONS['24h'],
      RANGE_OPTIONS['7d'],
    ],
    defaultValue: '1h',
  },
  historical: {
    options: [
      RANGE_OPTIONS['7d'],
      RANGE_OPTIONS['14d'],
      RANGE_OPTIONS['30d'],
      RANGE_OPTIONS['90d'],
    ],
    defaultValue: '30d',
  },
  'disk-usage': {
    options: [
      RANGE_OPTIONS['14d'],
      RANGE_OPTIONS['30d'],
      RANGE_OPTIONS['6m'],
      RANGE_OPTIONS['12m'],
      RANGE_OPTIONS.all,
    ],
    defaultValue: '30d',
  },
  'query-activity': {
    options: [
      RANGE_OPTIONS['24h'],
      RANGE_OPTIONS['7d'],
      RANGE_OPTIONS['30d'],
      RANGE_OPTIONS['12m'],
    ],
    defaultValue: '24h',
  },
  'query-duration': {
    options: [
      RANGE_OPTIONS['24h'],
      RANGE_OPTIONS['7d'],
      RANGE_OPTIONS['30d'],
      RANGE_OPTIONS['6m'],
      RANGE_OPTIONS['12m'],
    ],
    defaultValue: '7d',
  },
  'system-metrics': {
    options: [
      RANGE_OPTIONS['1h'],
      RANGE_OPTIONS['6h'],
      RANGE_OPTIONS['24h'],
      RANGE_OPTIONS['7d'],
      RANGE_OPTIONS['14d'],
      RANGE_OPTIONS['30d'],
    ],
    defaultValue: '24h',
  },
  operations: {
    options: [
      RANGE_OPTIONS['24h'],
      RANGE_OPTIONS['7d'],
      RANGE_OPTIONS['14d'],
      RANGE_OPTIONS['30d'],
    ],
    defaultValue: '24h',
  },
  health: {
    options: [
      RANGE_OPTIONS['24h'],
      RANGE_OPTIONS['7d'],
      RANGE_OPTIONS['14d'],
      RANGE_OPTIONS['30d'],
    ],
    defaultValue: '7d',
  },
  'page-views': {
    options: [
      RANGE_OPTIONS['14d'],
      RANGE_OPTIONS['30d'],
      RANGE_OPTIONS['6m'],
      RANGE_OPTIONS['12m'],
    ],
    defaultValue: '30d',
  },
  insights: {
    options: [
      RANGE_OPTIONS.all,
      RANGE_OPTIONS['12m'],
      RANGE_OPTIONS['6m'],
      RANGE_OPTIONS['90d'],
      RANGE_OPTIONS['30d'],
      RANGE_OPTIONS['7d'],
      RANGE_OPTIONS['24h'],
    ],
    defaultValue: 'all',
  },
} as const satisfies Record<string, DateRangeConfig>

export type DateRangePresetName = keyof typeof DATE_RANGE_PRESETS

export function resolveDateRangeConfig(
  configOrPreset: DateRangeConfig | DateRangePresetName
): DateRangeConfig {
  if (typeof configOrPreset === 'string') {
    return DATE_RANGE_PRESETS[configOrPreset]
  }
  return configOrPreset
}
