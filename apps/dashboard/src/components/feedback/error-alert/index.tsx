import type { ErrorAlertProps } from './types'

import { useErrorCountdown } from './use-error-countdown'
import { CompactErrorAlert, FullErrorAlert } from './variants'

export type { ErrorIconType } from './error-alert-icons'
export type { ErrorAlertVariant } from './error-alert-variants'
export type { ErrorAlertProps } from './types'
export type { CompactErrorAlertProps, FullErrorAlertProps } from './variants'

export const ErrorAlert = function ErrorAlert({
  title = 'Something went wrong!',
  message = 'Checking console for more details.',
  docs,
  query,
  reset,
  className,
  variant = 'destructive',
  errorType,
  digest,
  stack,
  compact = false,
}: ErrorAlertProps) {
  const { countdown } = useErrorCountdown({
    onCountdownComplete: reset,
    initialSeconds: 30,
  })

  if (compact) {
    return (
      <CompactErrorAlert
        title={title}
        message={message}
        className={className}
        variant={variant}
      />
    )
  }

  return (
    <FullErrorAlert
      title={title}
      message={message}
      docs={docs}
      query={query}
      reset={reset}
      className={className}
      variant={variant}
      errorType={errorType}
      digest={digest}
      stack={stack}
      countdown={countdown}
    />
  )
}
