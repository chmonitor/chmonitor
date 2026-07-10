/**
 * Debounced Input Component
 *
 * An input component with built-in debouncing to optimize performance
 * for search and filter operations. Prevents excessive updates/re-renders
 * while typing by delaying value changes until user stops typing.
 *
 * @example
 * ```tsx
 * <DebouncedInput
 *   placeholder="Search..."
 *   onValueChange={setSearchQuery}
 *   debounceMs={300}
 * />
 * ```
 */

import {
  type InputHTMLAttributes,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Input } from '@/components/ui/input'
import { useDebounceWithPending } from '@/lib/hooks'

export interface DebouncedInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  /** Callback fired when debounced value changes */
  onValueChange?: (value: string) => void
  /** Debounce delay in milliseconds (default: 300) */
  debounceMs?: number
  /** Show loading indicator while debounce is pending */
  showPendingIndicator?: boolean
  /** Initial value (for uncontrolled mode) */
  defaultValue?: string
  /** Controlled value (for controlled mode) */
  value?: string
}

export const DebouncedInput = memo(function DebouncedInput({
  onValueChange,
  debounceMs = 300,
  showPendingIndicator = false,
  defaultValue = '',
  value: controlledValue,
  className,
  ...props
}: DebouncedInputProps) {
  // Support both controlled and uncontrolled modes
  const isControlled = controlledValue !== undefined

  // Internal value tracks what the user is typing (for debouncing)
  // In controlled mode, this syncs with controlledValue but allows local edits
  const [internalValue, setInternalValue] = useState(
    controlledValue ?? defaultValue
  )

  // Sync internal value when controlled value changes from parent
  // This handles external updates (e.g., clear button, programmatic changes)
  const prevControlledValue = useRef(controlledValue)
  useEffect(() => {
    if (isControlled && controlledValue !== prevControlledValue.current) {
      setInternalValue(controlledValue)
      prevControlledValue.current = controlledValue
    }
  }, [isControlled, controlledValue])

  // The input always shows the internal value for responsive typing
  const inputValue = internalValue

  const { debouncedValue, isPending } = useDebounceWithPending(
    inputValue,
    debounceMs
  )

  // Store callback in ref to avoid triggering effect when callback reference changes
  // This prevents infinite loops when parent doesn't memoize onValueChange
  const onValueChangeRef = useRef(onValueChange)
  useEffect(() => {
    onValueChangeRef.current = onValueChange
  })

  // Track the last value we reported to parent to avoid duplicate calls
  const lastReportedValue = useRef(controlledValue ?? defaultValue)

  // Call onValueChange when debounced value changes
  // Only call if the value actually changed from what we last reported
  useEffect(() => {
    if (debouncedValue !== lastReportedValue.current) {
      lastReportedValue.current = debouncedValue
      onValueChangeRef.current?.(debouncedValue)
    }
  }, [debouncedValue])

  // Handle input changes - always update internal state, let debounce handle callback
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInternalValue(e.target.value)
  }, [])

  return (
    <div className="relative" role="search">
      <Input
        {...props}
        value={inputValue}
        onChange={handleChange}
        className={className}
        data-pending={isPending || undefined}
        aria-busy={isPending}
        aria-describedby={isPending ? 'search-pending' : undefined}
      />
      {showPendingIndicator && isPending && (
        <div
          className="absolute right-3 top-1/2 -translate-y-1/2"
          role="status"
          aria-label="Searching"
          id="search-pending"
        >
          <div className="flex h-4 w-4 items-center justify-center">
            <div
              className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full"
              aria-hidden="true"
            />
          </div>
          <span className="sr-only">Searching...</span>
        </div>
      )}
    </div>
  )
})
