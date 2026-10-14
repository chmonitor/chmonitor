/**
 * ErrorAlert types
 *
 * Shared TypeScript types for ErrorAlert components.
 */

import type { ErrorIconType } from './error-alert-icons'
import type { ErrorAlertVariant } from './error-alert-variants'

export interface ErrorAlertProps {
  /** Title of the error alert */
  title?: string
  /** Error message or custom content */
  message?: string | React.ReactNode | React.ReactNode[]
  docs?: string | React.ReactNode | React.ReactNode[]
  /** SQL query that caused the error */
  query?: string
  /** Reset callback to retry the operation */
  reset?: () => void
  className?: string
  /** Visual variant for the alert */
  variant?: ErrorAlertVariant
  /** Type of error for icon selection */
  errorType?: ErrorIconType
  digest?: string
  /** Stack trace for debugging */
  stack?: string
  compact?: boolean
}
