/**
 * Shared types, formatters, and tone maps for the Part Log page.
 *
 * The Part Log page renders the lifecycle of MergeTree parts from
 * `system.part_log`: creation, merges, mutations, downloads, moves and
 * removals. These helpers are shared between the chart strip
 * ({@link "./part-log-charts"}) and the events table
 * ({@link "./part-log-table"}).
 */

import {
  formatReadableQuantity,
  formatReadableSize,
} from '@/lib/format-readable'

export interface PartLogRow {
  event_time: string
  event_unixtime: number | string
  event_type: string
  database: string
  table_name: string
  table: string
  part_name: string
  partition_id: string
  merge_reason: string
  part_type: string
  part_level: number | string
  size_in_bytes: number | string
  readable_size: string
  rows: number | string
  readable_rows: string
  read_rows: number | string
  duration_ms: number | string
  readable_duration: string
  peak_memory_usage: number | string
  readable_peak_memory: string
  error: number | string
  exception: string
  [key: string]: unknown
}

export type Tone = 'green' | 'violet' | 'blue' | 'amber' | 'rose' | 'neutral'

/** Resolved CSS colors per tone (raw hex so SVG fills stay theme-stable). */
export const TONE_COLOR: Record<Tone, string> = {
  green: '#10b981',
  violet: '#8b5cf6',
  blue: '#3b82f6',
  amber: '#f59e0b',
  rose: '#f43f5e',
  neutral: '#94a3b8',
}

/** Tailwind classes for a soft badge per tone (light + dark). */
export const TONE_BADGE: Record<Tone, string> = {
  green:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  violet:
    'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300',
  blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300',
  amber:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  rose: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
  neutral: 'border-border bg-muted text-muted-foreground dark:bg-muted/40',
}

export const EVENT_TONE: Record<string, Tone> = {
  NewPart: 'green',
  MergeParts: 'violet',
  MergePartsStart: 'blue',
  MutatePart: 'amber',
  MutatePartStart: 'amber',
  DownloadPart: 'blue',
  MovePart: 'neutral',
  RemovePart: 'rose',
}

export type LifecycleClass = 'new' | 'merge' | 'mutate' | 'remove' | 'move'

export function lifecycleClass(eventType: string): LifecycleClass {
  if (eventType === 'NewPart') return 'new'
  if (eventType.startsWith('Merge')) return 'merge'
  if (eventType.startsWith('Mutate')) return 'mutate'
  if (eventType === 'RemovePart') return 'remove'
  return 'move' // MovePart, DownloadPart
}

export const REASON_TONE: Record<string, Tone> = {
  NotAMerge: 'neutral',
  RegularMerge: 'green',
  TTLDeleteMerge: 'amber',
  TTLRecompressMerge: 'violet',
}

const TABLE_TONES: Tone[] = [
  'amber',
  'violet',
  'blue',
  'rose',
  'green',
  'neutral',
]
export function tableTone(table: string): Tone {
  let sum = 0
  for (let i = 0; i < table.length; i++) sum += table.charCodeAt(i)
  return TABLE_TONES[sum % TABLE_TONES.length]
}

export const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function relativeAgo(unixSeconds: number, nowSeconds: number): string {
  const d = Math.max(0, nowSeconds - unixSeconds)
  if (d < 60) return `${d}s ago`
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  return `${Math.floor(d / 86400)}d ago`
}

export function timeOfDay(eventTime: string): string {
  const m = eventTime.match(/(\d{2}:\d{2}:\d{2})/)
  return m ? m[1] : eventTime
}

export interface SizeBin {
  label: string
  /** Upper bound (exclusive) in bytes; Infinity for the last bin. */
  max: number
}

export const SIZE_BINS: SizeBin[] = [
  { label: '<8K', max: 8 * 1024 },
  { label: '<64K', max: 64 * 1024 },
  { label: '<512K', max: 512 * 1024 },
  { label: '<4M', max: 4 * 1024 * 1024 },
  { label: '<32M', max: 32 * 1024 * 1024 },
  { label: '<256M', max: 256 * 1024 * 1024 },
  { label: '<1G', max: 1024 * 1024 * 1024 },
  { label: '>1G', max: Infinity },
]

export { formatReadableQuantity, formatReadableSize }
