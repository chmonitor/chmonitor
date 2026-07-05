import { useCallback, useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePathname, useRouter, useSearchParams } from '@/lib/next-compat'

export const SEVERITY_LEVELS = [
  'All',
  'Trace',
  'Debug',
  'Information',
  'Warning',
  'Error',
  'Fatal',
] as const

export type SeverityLevel = (typeof SEVERITY_LEVELS)[number]

interface LogFiltersProps {
  /** Called when the severity filter changes. Receives the new level, or undefined for "All". */
  onSeverityChange?: (severity: string | undefined) => void
  /** Called when the search text changes (debounced). */
  onSearchChange?: (search: string | undefined) => void
}

const DEBOUNCE_MS = 300

/**
 * Filter bar for log pages. Reads and writes severity/search to URL search params
 * so filters survive navigation and can be shared via URL.
 *
 * URL params used: `?severity=Error&search=keyword`
 */
export function LogFilters({
  onSeverityChange,
  onSearchChange,
}: LogFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const severityFromUrl = (searchParams.get('severity') ??
    'All') as SeverityLevel
  const searchFromUrl = searchParams.get('search') ?? ''

  const [searchInput, setSearchInput] = useState(searchFromUrl)

  // Keep local search state in sync when URL changes externally (e.g. back/forward).
  useEffect(() => {
    setSearchInput(searchFromUrl)
  }, [searchFromUrl])

  const updateParam = useCallback(
    (key: string, value: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value && value !== 'All' && value !== '') {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`)
    },
    [router, pathname, searchParams]
  )

  const handleSeverityChange = useCallback(
    (value: string) => {
      const level = value === 'All' ? undefined : value
      updateParam('severity', level)
      onSeverityChange?.(level)
    },
    [updateParam, onSeverityChange]
  )

  // Debounce the search input before writing to the URL.
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = searchInput.trim()
      updateParam('search', trimmed || undefined)
      onSearchChange?.(trimmed || undefined)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput, updateParam, onSearchChange])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={severityFromUrl}
        onValueChange={(value) => {
          if (value == null) return
          handleSeverityChange(value)
        }}
      >
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue placeholder="Severity" />
        </SelectTrigger>
        <SelectContent>
          {SEVERITY_LEVELS.map((level) => (
            <SelectItem key={level} value={level} className="text-xs">
              {level}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search messages…"
        className="h-8 w-48 text-xs"
        aria-label="Search log messages"
      />
    </div>
  )
}
