export { cn } from 'cn'

export function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr))
}

export function dedent(str: string) {
  str = str.replace(/^\n/, '').replace(/\n\s*$/, '')
  const match = str.match(/^[ \t]*(?=\S)/gm)
  if (!match) return str
  const indent = Math.min(...match.map((x) => x.length))
  const re = new RegExp(`^[ \\t]{${indent}}`, 'gm')
  return indent > 0 ? str.replace(re, '') : str
}

export function getHost(url?: string) {
  if (!url) return ''
  const { host } = new URL(url)
  return host
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 0) return '-'
  if (!Number.isFinite(bytes) || Number.isNaN(bytes)) return '-'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const safeIndex = Math.min(Math.max(i, 0), sizes.length - 1)
  return `${(bytes / k ** safeIndex).toFixed(1)} ${sizes[safeIndex]}`
}

export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`
}

export function formatCount(count: number): string {
  if (!Number.isFinite(count) || Number.isNaN(count)) return '-'
  if (count < 0) return '-'
  if (count < 1000) return count.toString()
  const units = ['', 'K', 'M', 'B', 'T']
  const unitIndex = Math.floor(Math.log(count) / Math.log(1000))
  const safeUnitIndex = Math.min(Math.max(unitIndex, 0), units.length - 1)
  return `${(count / 1000 ** safeUnitIndex).toFixed(1)}${units[safeUnitIndex]}`
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || Number.isNaN(ms)) return '-'
  const sign = ms < 0 ? '-' : ''
  const abs = Math.abs(ms)
  if (abs < 1000) return `${sign}${Number(abs.toFixed(2))}ms`
  if (abs < 60000) return `${sign}${(abs / 1000).toFixed(1)}s`
  if (abs < 3600000) return `${sign}${(abs / 60000).toFixed(1)}m`
  return `${sign}${(abs / 3600000).toFixed(1)}h`
}

export const chartTickFormatters = {
  bytes: (value: string | number | null | undefined) =>
    value === null || value === undefined ? '-' : formatBytes(Number(value)),
  percentage: (value: string | number | null | undefined) =>
    value === null || value === undefined
      ? '-'
      : formatPercentage(Number(value)),
  count: (value: string | number | null | undefined) =>
    value === null || value === undefined ? '-' : formatCount(Number(value)),
  duration: (value: string | number | null | undefined) =>
    value === null || value === undefined ? '-' : formatDuration(Number(value)),
  default: (value: string | number | null | undefined) =>
    value === null || value === undefined ? '-' : value.toString(),
}

export function createDateTickFormatter(
  lastHours: number,
  timezone?: string
): (value: string) => string {
  return (value: string) => {
    if (!value) return ''
    try {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value
      if (lastHours <= 24) {
        return date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: timezone,
        })
      }
      if (lastHours <= 24 * 7) {
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: timezone,
        })
      }
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: timezone,
      })
    } catch {
      return value
    }
  }
}
