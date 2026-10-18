import type { ErrorIconType } from './error-alert-icons'
import type { ErrorAlertVariant } from './error-alert-variants'

export interface ErrorAlertProps {
  title?: string
  message?: string | React.ReactNode | React.ReactNode[]
  docs?: string | React.ReactNode | React.ReactNode[]
  query?: string
  reset?: () => void
  className?: string
  variant?: ErrorAlertVariant
  errorType?: ErrorIconType
  digest?: string
  stack?: string
  compact?: boolean
}
