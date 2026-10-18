import type { ReadWritePair, SummaryMetricsItem } from '../types'

export function extractNestedData<T>(
  data: unknown[] | undefined,
  key: string
): T[] | undefined {
  const firstItem = data?.[0] as Record<string, unknown> | undefined
  if (!firstItem || typeof firstItem !== 'object') {
    return undefined
  }

  const nested = firstItem[key]
  return Array.isArray(nested) ? (nested as T[]) : undefined
}

export function formatReadWritePair(
  read: ReadWritePair,
  write: ReadWritePair,
  unit: string = ''
): SummaryMetricsItem {
  const isReadSmaller = read.value < write.value
  const unitPrefix = unit ? `${unit} ` : ''

  if (isReadSmaller) {
    return {
      current: read.value,
      target: write.value,
      currentReadable: `${read.readable} ${unitPrefix}read`.trim(),
      targetReadable: `${write.readable} ${unitPrefix}written`.trim(),
    }
  } else {
    return {
      current: write.value,
      target: read.value,
      currentReadable: `${write.readable} ${unitPrefix}written`.trim(),
      targetReadable: `${read.readable} ${unitPrefix}read`.trim(),
    }
  }
}
